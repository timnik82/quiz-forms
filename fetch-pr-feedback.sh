#!/bin/bash

# GitHub PR Feedback Fetcher
# This script fetches complete PR feedback using the GitHub REST API
# Fetches three types of feedback:
#   1. PR Details (metadata, stats, description)
#   2. General Comments (PR-level comments)
#   3. Review Comments (line-specific code review comments)
#
# Required Environment Variables:
#   GITHUB_TOKEN - GitHub Personal Access Token
#   GITHUB_REPO - Repository in format "owner/repo" (e.g., "owner/repo-name")
#   GITHUB_API_BASE - GitHub API base URL (default: https://api.github.com)
#
# Usage:
#   ./fetch-pr-comments.sh <PR_NUMBER>       # Fetch all feedback for specific PR
#   ./fetch-pr-comments.sh current           # Fetch all feedback for PR of current branch
#   ./fetch-pr-comments.sh list              # List recent PRs
#   ./fetch-pr-comments.sh search <text>     # Search PRs by branch name (client-side)
#   ./fetch-pr-comments.sh api-search <text> # Search PRs using GitHub Search API (server-side)

set -e -o pipefail

# Validate environment variables
if [ -z "$GITHUB_TOKEN" ]; then
    echo "Error: GITHUB_TOKEN environment variable is required"
    exit 1
fi

if [ -z "$GITHUB_REPO" ]; then
    echo "Error: GITHUB_REPO environment variable is required"
    exit 1
fi

if [ -z "$GITHUB_API_BASE" ]; then
    GITHUB_API_BASE="https://api.github.com"
fi

# Common headers for GitHub API v3
HEADERS=(
    -H "Accept: application/vnd.github+json"
    -H "Authorization: Bearer $GITHUB_TOKEN"
    -H "X-GitHub-Api-Version: 2022-11-28"
)

# Function to get PR number for current branch
get_current_pr() {
    local branch
    branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
    if [ -z "$branch" ]; then
        echo "Error: Not in a git repository" >&2
        exit 1
    fi

    echo "Finding PR for branch: $branch" >&2

    # Use GitHub Search API with head:<branch> qualifier for efficiency and security
    local query="repo:$GITHUB_REPO is:pr head:$branch"
    local encoded_query
    encoded_query=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$query")

    # Search for the PR and get the most recently updated one
    local pr_data
    pr_data=$(curl -s -L "${HEADERS[@]}" \
        "$GITHUB_API_BASE/search/issues?q=$encoded_query&sort=updated&order=desc&per_page=1")

    # Safely parse the PR number from the JSON response
    local pr_number
    pr_number=$(python3 -c "
import json, sys
try:
    result = json.load(sys.stdin)
    if result.get('items'):
        print(result['items'][0]['number'])
except (json.JSONDecodeError, IndexError, KeyError):
    pass
" <<< "$pr_data")

    if [ -z "$pr_number" ]; then
        echo "Error: No PR found for branch '$branch'" >&2
        exit 1
    fi

    echo "$pr_number"
}

# Function to list recent PRs
list_recent_prs() {
    echo "Fetching 20 most recent pull requests..."
    curl -s -L "${HEADERS[@]}" \
        "$GITHUB_API_BASE/repos/$GITHUB_REPO/pulls?state=all&per_page=20" \
        | python3 -c "
import json, sys
try:
    prs = json.load(sys.stdin)
    if not prs:
        print('No pull requests found')
    else:
        for pr in prs:
            print(f\"PR #{pr['number']}: {pr['title']}\")
            print(f\"  Branch: {pr['head']['ref']}\")
            print(f\"  State: {pr['state']}\")
            print(f\"  URL: {pr['html_url']}\")
            print()
except Exception as e:
    print(f'Error parsing response: {e}', file=sys.stderr)
    sys.exit(1)
"
}

# Function to search PRs by branch name (client-side filtering)
# Note: This only searches the first 100 PRs. For larger repos, use api-search instead.
search_prs_client() {
    local search_term="$1"
    echo "Searching for PRs with branch containing: $search_term"
    echo "(Searching first 100 PRs - use 'api-search' for comprehensive search)"
    curl -s -L "${HEADERS[@]}" \
        "$GITHUB_API_BASE/repos/$GITHUB_REPO/pulls?state=all&per_page=100" \
        | python3 -c "
import json, sys

if len(sys.argv) < 2:
    print('Error: search term not provided to python script', file=sys.stderr)
    sys.exit(1)

search = sys.argv[1]
try:
    prs = json.load(sys.stdin)
    found = False
    for pr in prs:
        if search.lower() in pr['head']['ref'].lower():
            found = True
            print(f\"PR #{pr['number']}: {pr['title']}\")
            print(f\"  Branch: {pr['head']['ref']}\")
            print(f\"  State: {pr['state']}\")
            print(f\"  URL: {pr['html_url']}\")
            body = pr.get('body', '')
            if body:
                print(f\"  Description: {body[:200]}...\")
            print()
    if not found:
        print('No PRs found matching search term in first 100 results')
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
    sys.exit(1)
" "$search_term"
}

# Function to search PRs using GitHub Search API (server-side)
# This is more scalable and searches across all PRs in the repository
search_prs_api() {
    local search_term="$1"
    echo "Searching for PRs using GitHub Search API: $search_term"

    # URL encode the search query
    local query="repo:$GITHUB_REPO is:pr $search_term in:branch"
    local encoded_query=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$query'))")

    curl -s -L "${HEADERS[@]}" \
        "$GITHUB_API_BASE/search/issues?q=$encoded_query&per_page=20" \
        | python3 -c "
import json, sys

try:
    result = json.load(sys.stdin)
    items = result.get('items', [])
    total_count = result.get('total_count', 0)

    print(f\"Found {total_count} result(s) (showing up to 20):\\n\")

    if not items:
        print('No PRs found matching search term')
    else:
        for pr in items:
            # Extract PR number from URL
            pr_number = pr['number']
            print(f\"PR #{pr_number}: {pr['title']}\")
            print(f\"  State: {pr['state']}\")
            print(f\"  URL: {pr['html_url']}\")
            body = pr.get('body', '')
            if body:
                print(f\"  Description: {body[:200]}...\")
            print()
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
    sys.exit(1)
"
}

# Function to fetch all PR feedback (details, general comments, and review comments)
fetch_pr_comments() {
    local pr_number="$1"

    echo "=== Fetching all feedback for PR #$pr_number ==="
    echo ""

    # Get PR details/metadata
    echo "PR Details:"
    echo "-----------"
    curl -s -L "${HEADERS[@]}" \
        "$GITHUB_API_BASE/repos/$GITHUB_REPO/pulls/$pr_number" \
        | python3 -c "
import json, sys
try:
    pr = json.load(sys.stdin)
    if 'number' in pr:
        print(f\"PR #{pr['number']}: {pr['title']}\")
        print(f\"State: {pr['state']}\")
        print(f\"Author: @{pr['user']['login']}\")
        print(f\"Created: {pr['created_at']}\")
        print(f\"Updated: {pr['updated_at']}\")
        print(f\"Branch: {pr['head']['ref']} → {pr['base']['ref']}\")
        print(f\"URL: {pr['html_url']}\")
        print(f\"\nDescription:\")
        print(pr['body'] or '(no description)')
        print(f\"\nStats:\")
        print(f\"  Commits: {pr['commits']}\")
        print(f\"  Changed files: {pr['changed_files']}\")
        print(f\"  Additions: +{pr['additions']}\")
        print(f\"  Deletions: -{pr['deletions']}\")
    else:
        print(f\"Error: {pr.get('message', 'Unknown error')}\")
        sys.exit(1)
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
    sys.exit(1)
"

    echo ""
    echo ""
    echo "General Comments:"
    echo "----------------"
    curl -s -L "${HEADERS[@]}" \
        "$GITHUB_API_BASE/repos/$GITHUB_REPO/issues/$pr_number/comments" \
        | python3 -c "
import json, sys
try:
    comments = json.load(sys.stdin)
    if not comments or len(comments) == 0:
        print('No general comments found')
    else:
        for comment in comments:
            user = comment['user']['login']
            created = comment['created_at']
            body = comment['body']
            url = comment['html_url']
            print(f\"\\n@{user} - {created}\")
            print(f\"{body}\")
            print(f\"URL: {url}\")
            print('-' * 80)
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
"

    echo ""
    echo ""
    echo "Code Review Comments (line-specific):"
    echo "--------------------------------------"

    # Get review comments (line-specific)
    curl -s -L "${HEADERS[@]}" \
        "$GITHUB_API_BASE/repos/$GITHUB_REPO/pulls/$pr_number/comments" \
        | python3 -c "
import json, sys
try:
    comments = json.load(sys.stdin)
    if not comments or len(comments) == 0:
        print('No review comments found')
    else:
        for comment in comments:
            user = comment['user']['login']
            path = comment.get('path', 'N/A')
            line = comment.get('original_line', 'N/A')
            body = comment['body']
            url = comment['html_url']
            print(f\"\\n@{user} - {path}:{line}\")
            print(f\"{body}\")
            print(f\"URL: {url}\")
            print('-' * 80)
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
"
}

# Main script logic
case "${1:-}" in
    list)
        list_recent_prs
        ;;
    search)
        if [ -z "$2" ]; then
            echo "Error: search term required"
            echo "Usage: $0 search <term>"
            exit 1
        fi
        search_prs_client "$2"
        ;;
    api-search)
        if [ -z "$2" ]; then
            echo "Error: search term required"
            echo "Usage: $0 api-search <term>"
            exit 1
        fi
        search_prs_api "$2"
        ;;
    current)
        # Fetch all feedback for PR associated with current branch
        PR_NUMBER=$(get_current_pr)
        fetch_pr_comments "$PR_NUMBER"
        ;;
    "")
        echo "Usage: $0 <command> [args]"
        echo ""
        echo "Commands:"
        echo "  list                  - List 20 most recent pull requests"
        echo "  search <text>         - Search PRs by branch name (first 100 PRs only)"
        echo "  api-search <text>     - Search PRs using GitHub Search API (comprehensive)"
        echo "  current               - Fetch all feedback for PR of current branch"
        echo "  <PR_NUMBER>           - Fetch all feedback for specific PR"
        echo ""
        echo "Feedback includes: PR details, general comments, and line-specific review comments"
        echo ""
        echo "Examples:"
        echo "  $0 list"
        echo "  $0 search exercise-wheel"
        echo "  $0 api-search feature-branch"
        echo "  $0 current"
        echo "  $0 68"
        echo ""
        echo "Note: 'api-search' is recommended for repositories with many PRs"
        exit 1
        ;;
    *)
        # Assume it's a PR number
        if [[ "$1" =~ ^[0-9]+$ ]]; then
            fetch_pr_comments "$1"
        else
            echo "Error: Invalid command or PR number: $1"
            exit 1
        fi
        ;;
esac
