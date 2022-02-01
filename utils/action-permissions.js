import {Octokit} from '@octokit/core'
import chalk from 'chalk'
import {load} from 'js-yaml'
import {paginateRest} from '@octokit/plugin-paginate-rest'
// eslint-disable-next-line import/no-unresolved
import {stringify} from 'csv-stringify/sync'
import {throttling} from '@octokit/plugin-throttling'
// eslint-disable-next-line import/extensions
import wait from './wait.js'
import {writeFileSync} from 'fs'

const {blue, dim, inverse, red, yellow} = chalk
const MyOctokit = Octokit.plugin(throttling, paginateRest)

const ORG_QUERY = `query ($enterprise: String!, $cursor: String = null) {
  enterprise(slug: $enterprise) {
    organizations(first: 25, after: $cursor) {
      nodes {
        login
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}`

/**
 * @async
 * @private
 * @function getOrganizations
 *
 * @param {import('@octokit/core').Octokit} octokit
 * @param {String} enterprise
 * @param {String} [cursor=null]
 * @param {Organization[]} [records=[]]
 *
 * @returns {Organization[]}
 */
const getOrganizations = async (octokit, enterprise, cursor = null, records = []) => {
  if (!enterprise) return records

  const {
    enterprise: {
      organizations: {nodes, pageInfo}
    }
  } = await octokit.graphql(ORG_QUERY, {enterprise, cursor})

  nodes.map(data => {
    /** @type Organization */
    records.push(data.login)
  })

  if (pageInfo.hasNextPage) {
    await getOrganizations(octokit, enterprise, pageInfo.endCursor, records)
  }

  return records
}

/**
 * @async
 * @private
 * @function findActionsUsed
 *
 * @param {import('@octokit/core').Octokit} octokit
 * @param {object} options
 * @param {string} options.owner
 * @param {string} [options.repo=null]
 *
 * @returns {Action[]}
 */
const findActionPermissions = async (octokit, {owner, repo = null}) => {
  const workflows = []

  /** @type Action[] */
  const actions = []

  let q = `GITHUB_TOKEN in:file path:.github/workflows extension:yml language:yaml`

  if (repo !== null) {
    q += ` repo:${owner}/${repo}`
  } else {
    q += ` user:${owner}`
  }

  try {
    for await (const {data} of octokit.paginate.iterator('GET /search/code', {
      q,
      per_page: 100
    })) {
      if (data.total_count > 0) {
        data.map(item => {
          const {
            name,
            path,
            repository: {name: r},
            sha
          } = item

          workflows.push({
            owner,
            repo: r,
            name,
            path,
            sha
          })
        })
      }

      // always wait 3s to not hit the 30 requests per minute rate limit
      await wait(3000)
    }

    for await (const {repo: _repo, path} of workflows) {
      const {data: wf} = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
        owner,
        repo: _repo,
        path
      })

      // console.log(wf)

      if (wf.content) {
        const buff = Buffer.from(wf.content, 'base64')
        const content = buff.toString('utf-8')
        const yaml = load(content, 'utf8')
        const permissions = recursiveSearch(yaml, 'permissions')

        actions.push({owner, repo: _repo, workflow: path, permissions})
      }
    }
  } catch (error) {
    if (error.status === 401) {
      throw new Error('Bad credentials')
    }

    console.warn(
      `${owner} cannot be searched either because the resources do not exist or you do not have permission to view them`
    )
  }

  return actions.sort(sortActions)
}

/**
 * @private
 * @function sortActions
 *
 * @param {Action} a
 * @param {Action} b
 *
 * @returns {number}
 */
const sortActions = (a, b) => {
  // Use toUpperCase() to ignore character casing
  const A = a.workflow.toUpperCase()
  const B = b.workflow.toUpperCase()

  let comparison = 0

  if (A > B) {
    comparison = 1
  } else if (A < B) {
    comparison = -1
  }

  return comparison
}

/**
 * @private
 * @function recursiveSearch
 *
 * @param {object} obj
 * @param {string} searchKey
 * @param {any[]} [results=[]]
 *
 * @returns {any}
 */
const recursiveSearch = (obj, searchKey, results = []) => {
  const r = results

  for (const key in obj) {
    const value = obj[key]

    if (typeof value === 'object' && key !== searchKey) {
      recursiveSearch(value, searchKey, r)
    } else if (key === searchKey) {
      r.push(value)
    }
  }

  return r
}

class ActionPermissions {
  /**
   * @param {string} token
   * @param {string} enterprise
   * @param {string} owner
   * @param {string} repository
   * @param {string} csv
   * @param {string} md
   * @param {boolean} exclude
   */
  constructor(token, enterprise, owner, repository, csv, md) {
    this.token = token
    this.enterprise = enterprise
    this.owner = owner
    this.repository = repository
    this.csvPath = csv
    this.mdPath = md

    this.octokit = new MyOctokit({
      auth: token,
      throttle: {
        onRateLimit: (retryAfter, options) => {
          console.warn(yellow(`Request quota exhausted for request ${options.method} ${options.url}`))

          if (options.request.retryCount === 0) {
            console.warn(yellow(`Retrying after ${retryAfter} seconds!`))
            return true
          }
        },
        onAbuseLimit: (_retryAfter, options) => {
          console.warn(yellow(`Abuse detected for request ${options.method} ${options.url}`))
        }
      }
    })
  }

  /**
   * @returns {Action[]}
   */
  async getActionPermissionsUse() {
    const {octokit, enterprise, owner, repository} = this

    console.log(`
Gathering GitHub Action ${inverse('permissions')} strings for ${blue(enterprise || owner || repository)}
${dim('(this could take a while...)')}
`)

    let actions = []

    if (enterprise) {
      const orgs = await getOrganizations(octokit, enterprise)
      console.log(`${dim(`searching in %s organizations`)}`, orgs.length)

      for await (const org of orgs) {
        console.log(`searching actions for ${org}`)

        const res = await findActionPermissions(octokit, {owner: org})
        actions.push(...res)
      }
    }

    if (owner) {
      actions = await findActionPermissions(octokit, {owner})
    }

    if (repository) {
      const [repoOwner, repo] = repository.split('/')

      actions = await findActionPermissions(octokit, {owner: repoOwner, repo})
    }

    return actions
  }

  /**
   * @param {Action[]} actions
   * @returns {string}
   */
  async saveCsv(actions) {
    const {csvPath} = this

    console.log(`saving CSV in ${blue(`${csvPath}`)}`)

    const csv = stringify(
      actions.map(i => [i.owner, i.repo, i.workflow, i.permissions]),
      {
        header: true,
        columns: ['owner', 'repo', 'workflow', 'permissions']
      }
    )

    try {
      await writeFileSync(csvPath, csv)
    } catch (error) {
      console.error(red(error.message))
    }

    return csv
  }

  /**
   * @param {Action[]} actions
   * @returns {string}
   */
  async saveMarkdown(actions) {
    const {mdPath} = this

    console.log(`saving markdown in ${blue(`${mdPath}`)}`)

    let md = `owner | repo | workflow | permissions
----- | ----- | ----- | -----
`

    try {
      for (const {owner, repo, workflow, permissions} of actions) {
        const workflowLink = `https://github.com/${owner}/${repo}/blob/HEAD/${workflow}`

        md += `${owner} | ${repo} | [${workflow}](${workflowLink}) | ${JSON.stringify(permissions)}
`
      }
      writeFileSync(mdPath, md)
    } catch (error) {
      console.error(red(error.message))
    }

    return md
  }
}

/**
 * @typedef {object} Action
 * @property {string} action
 * @property {string} [owner]
 * @property {string} [repo]
 * @property {string} [workflow]
 * @readonly
 */

/**
 * @typedef {object} Organization
 * @property {string} login
 * @readonly
 */

export default ActionPermissions
