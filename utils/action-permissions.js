import {Octokit} from '@octokit/core'
import chalk from 'chalk'
import {load} from 'js-yaml'
import {paginateRest} from '@octokit/plugin-paginate-rest'
import {stringify} from 'csv-stringify/sync'
import {throttling} from '@octokit/plugin-throttling'
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

const ORG_REPO_QUERY = `query ($owner: String!, $cursor: String = null) {
  organization(login: $owner) {
    repositories(
      affiliations: OWNER
      isFork: false
      orderBy: { field: PUSHED_AT, direction: DESC }
      first: 100
      after: $cursor
    ) {
      nodes {
        name
        owner {
          login
        }
        isArchived
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}`

const USER_REPO_QUERY = `query ($owner: String!, $cursor: String = null) {
  user(login: $owner) {
    repositories(
      affiliations: OWNER
      isFork: false
      orderBy: { field: PUSHED_AT, direction: DESC }
      first: 100
      after: $cursor
    ) {
      nodes {
        name
        owner {
          login
        }
        isArchived
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
 * @param {string} enterprise
 * @param {string} [cursor=null]
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
 * @function getRepositories
 *
 * @param {import('@octokit/core').Octokit} octokit
 * @param {Organization} owner
 * @param {string} [type='organization']
 * @param {string} [cursor=null]
 * @param {Repository[]} [records=[]]
 *
 * @returns {Repository[]}
 */
const getRepositories = async (octokit, owner, type = 'organization', cursor = null, records = []) => {
  let nodes = []
  let pageInfo = {
    hasNextPage: false,
    endCursor: null
  }

  if (type === 'organization') {
    const {
      organization: {repositories}
    } = await octokit.graphql(ORG_REPO_QUERY, {owner, cursor})

    nodes = repositories.nodes
    pageInfo = repositories.pageInfo
  } else if (type === 'user') {
    const {
      user: {repositories}
    } = await octokit.graphql(USER_REPO_QUERY, {owner, cursor})

    nodes = repositories.nodes
    pageInfo = repositories.pageInfo
  }

  nodes.map(data => {
    // skip if repository is archived
    if (data.isArchived) return

    if (data.owner.login === owner) {
      /** @type Repository */
      records.push({
        owner: data.owner.login,
        repo: data.name
      })
    }
  })

  if (pageInfo.hasNextPage) {
    await getRepositories(octokit, owner, type, pageInfo.endCursor, records)
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
 * @param {string} options.repo
 *
 * @returns {Action[]}
 */
const findActionPermissions = async (octokit, {owner, repo}) => {
  /** @type Action[] */
  const actions = []

  try {
    const {data} = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner,
      repo,
      path: '.github/workflows'
    })

    for await (const wf of data) {
      const {
        data: {content}
      } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
        owner,
        repo,
        path: wf.path
      })

      if (content) {
        const _buff = Buffer.from(content, 'base64')
        const _content = _buff.toString('utf-8')
        const yaml = load(_content, 'utf8')
        const permissions = recursiveSearch(yaml, 'permissions')

        actions.push({owner, repo, workflow: wf.path, permissions})
      }
    }
  } catch (error) {
    // do nothing
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
          console.warn(yellow(`Retrying after ${retryAfter} seconds!`))
          return true
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

    const actions = []
    let repos = []

    if (enterprise) {
      const orgs = await getOrganizations(octokit, enterprise)
      console.log(`${dim(`searching in %s enterprise organizations\n[%s]`)}`, orgs.length, orgs.join(', '))

      for await (const org of orgs) {
        const res = await getRepositories(octokit, org)
        repos.push(...res)
      }
    }

    if (owner) {
      const {
        data: {type}
      } = await octokit.request('GET /users/{owner}', {
        owner
      })

      console.log(`${dim(`searching %s %s`)}`, type.toLowerCase(), owner)
      repos = await getRepositories(octokit, owner, type.toLowerCase())
    }

    if (repository) {
      const [_o, _r] = repository.split('/')

      console.log(`${dim(`searching %s/%s`)}`, _o, _r)
      repos.push({owner: _o, repo: _r})
    }

    let i = 0
    for await (const {owner: org, repo} of repos) {
      const ul = i === repos.length - 1 ? '└─' : '├─'

      console.log(`  ${ul} ${org}/${repo}`)
      const res = await findActionPermissions(octokit, {owner: org, repo})

      actions.push(...res)

      // wait 2.5s between repositories to help spread out the requests
      wait(2500)

      i++
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

/**
 * @typedef {object} Repository
 * @property {string} owner
 * @property {string} repo
 * @readonly
 */

export default ActionPermissions
