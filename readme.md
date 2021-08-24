# action-permissions-cli

[![test](https://github.com/stoe/action-permissions-cli/actions/workflows/test.yml/badge.svg)](https://github.com/stoe/action-permissions-cli/actions/workflows/test.yml) [![codeql](https://github.com/stoe/action-permissions-cli/actions/workflows/codeql.yml/badge.svg)](https://github.com/stoe/action-permissions-cli/actions/workflows/codeql.yml) [![publish](https://github.com/stoe/action-permissions-cli/actions/workflows/publish.yml/badge.svg)](https://github.com/stoe/action-permissions-cli/actions/workflows/publish.yml) [![styled with prettier](https://img.shields.io/badge/styled_with-prettier-ff69b4.svg)](https://github.com/prettier/prettier)

> CLI to grab GitHub action `permissions` for actions using `GITHUB_TOKEN`.
>
> Useful if you want to get started with [Control permissions for `GITHUB_TOKEN`](https://github.blog/changelog/2021-04-20-github-actions-control-permissions-for-github_token/) but don't know where that token is used across your enterprise/organisation/user repositories.

## Usage

```sh
$ npx @stoe/action-permissions-cli [--options]
```

## Required options (one of)

- `--enterprise`, `-e` GitHub Enterprise Cloud account slug (e.g. `enterprise`)
- `--owner`, `-o` GitHub organization/user login (e.g. `owner`)
  If --owner is a user, results for the authenticated user (--token) will be returned
- `--repository`, `-r` GitHub repository name with owner (e.g. `owner/repo`)

## Additional options

- `--csv` Path to CSV file for the output (e.g. `/path/to/action-uses.csv`)
- `--md` Path to markdown file for the output (e.g. `/path/to/action-uses.md`)
- `--token`, `-t` GitHub Personal Access Token (PAT) (default `GITHUB_TOKEN`)
- `--help`, `-h` Print action-permissions-cli help
- `--version`, `-v` Print action-permissions-cli version

## Examples

```sh
# Output GitHub Actions `uses` for all repositories under a GitHub Enterprise Cloud account to stdout
$ action-permissions-cli -e my-enterprise

# Output GitHub Actions `uses` for all organization repositories to stdout
$ action-permissions-cli -o my-org

# Output GitHub Actions `uses` for all user repositories to stdout
$ action-permissions-cli -o stoe

# Output GitHub Actions `uses` for the stoe/action-permissions-cli repository to stdout
$ action-permissions-cli -o stoe/action-permissions-cli

# Output GitHub Actions `uses` for all organization repositories to /path/to/action-uses.csv
$ action-permissions-cli -o my-org --csv /path/to/action-uses.csv

# Output GitHub Actions `uses` for all organization repositories to /path/to/action-uses.md
$ action-permissions-cli -o my-org --md /path/to/action-uses.md
```

## License

[MIT](./license) © [Stefan Stölzle](https://github.com/stoe)
