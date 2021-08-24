#!/usr/bin/env node

import chalk from 'chalk'
import meow from 'meow'
import ActionPermissions from './utils/ActionPermissions.mjs'

const {dim, blue, bold, red, yellow} = chalk
const cli = meow(
  `
  ${bold('Usage')}
    ${blue(`action-permissions-cli`)} ${yellow(`[--options]`)}

  ${bold('Required options')} ${dim('one of')}
    ${yellow(`--enterprise`)}, ${yellow(`-e`)}     GitHub Enterprise Cloud account slug ${dim('(e.g. enterprise)')}
    ${yellow(`--owner`)}, ${yellow(`-o`)}          GitHub organization/user login ${dim('(e.g. owner)')}
                         ${dim(
                           `If ${yellow(`--owner`)} is a user, results for the authenticated user (${yellow(
                             `--token`
                           )}) will be returned`
                         )}
    ${yellow(`--repository`)}, ${yellow(`-r`)}     GitHub repository name with owner ${dim('(e.g. owner/repo)')}

  ${bold('Additional options')}
    ${yellow(`--csv`)}                Path to CSV for the output ${dim('(e.g. /path/to/action-permissions.csv)')}
    ${yellow(`--md`)}                 Path to markdown for the output ${dim('(e.g. /path/to/action-permissions.md)')}
    ${yellow(`--token`)}, ${yellow(`-t`)}          GitHub Personal Access Token (PAT) ${dim('(default GITHUB_TOKEN)')}

    ${yellow(`--help`)}, ${yellow(`-h`)}           Print action-permissions-cli help
    ${yellow(`--version`)}, ${yellow(`-v`)}        Print action-permissions-cli version

  ${bold('Examples')}
    ${dim(
      '# Output GitHub Actions `permissions` for all repositories under a GitHub Enterprise Cloud account to stdout'
    )}
    $ action-permissions-cli -e my-enterprise

    ${dim('# Output GitHub Actions `use` for all organization repositories to stdout')}
    $ action-permissions-cli -o my-org

    ${dim('# Output GitHub Actions `permissions` for all user repositories to stdout')}
    $ action-permissions-cli -o stoe

    ${dim('# Output GitHub Actions `permissions` for the stoe/action-permissions-cli repository to stdout')}
    $ action-permissions-cli -o stoe/action-permissions-cli

    ${dim('# Output GitHub Actions `permissions` for all organization repositories to /path/to/action-permissions.csv')}
    $ action-permissions-cli -o my-org --csv /path/to/action-permissions.csv

    ${dim('# Output GitHub Actions `permissions` for all organization repositories to /path/to/action-permissions.md')}
    $ action-permissions-cli -o my-org --md /path/to/action-permissions.md
`,
  {
    booleanDefault: undefined,
    description: false,
    hardRejection: false,
    allowUnknownFlags: false,
    importMeta: import.meta,
    inferType: false,
    input: [],
    flags: {
      help: {
        type: 'boolean',
        alias: 'h'
      },
      version: {
        type: 'boolean',
        alias: 'v'
      },
      enterprise: {
        type: 'string',
        alias: 'e'
      },
      owner: {
        type: 'string',
        alias: 'o',
        isMultiple: false
      },
      repository: {
        type: 'string',
        alias: 'r',
        isMultiple: false
      },
      unique: {
        type: 'boolean',
        default: false
      },
      csv: {
        type: 'string'
      },
      md: {
        type: 'string'
      },
      token: {
        type: 'string',
        alias: 't',
        default: process.env.GITHUB_TOKEN || ''
      }
    }
  }
)

// action
;(async () => {
  try {
    // Get options/flags
    const {help, version, enterprise, unique, owner, repository, csv, md, token} = cli.flags

    help && cli.showHelp(0)
    version && cli.showVersion(0)

    if (!token) {
      throw new Error('GitHub Personal Access Token (PAT) not provided')
    }

    if (!(enterprise || owner || repository)) {
      throw new Error('no options provided')
    }

    if ((enterprise && owner) || (enterprise && repository) || (owner && repository)) {
      throw new Error('can only use one of: enterprise, owner, repository')
    }

    if (csv === '') {
      throw new Error('please provide a valid path for the CSV output')
    }

    if (md === '') {
      throw new Error('please provide a valid path for the markdown output')
    }

    const fau = new ActionPermissions(token, enterprise, owner, repository, csv, md)
    const actions = await fau.getActionPermissionsUse()

    // create and save CSV
    if (csv) {
      fau.saveCsv(actions, unique)
    }

    // create and save markdown
    if (md) {
      fau.saveMarkdown(actions, unique)
    }

    // always output JSON to stdout
    console.log(JSON.stringify(actions, null, 2))
  } catch (error) {
    console.error(`\n  ${red('ERROR: %s')}`, error.message)
    cli.showHelp(1)
  }
})()
