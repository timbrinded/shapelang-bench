## Task-Specific Behavior

Implement an issue tracker with users, teams, issues, comments, status
transitions, label filtering, and team summaries.

Authentication uses `Authorization: Token <token>`.

Rules:

- Users belong to exactly one team.
- Issues belong to a team and can have labels.
- Valid status transitions are `todo -> doing -> done`. `todo -> done` is
  invalid.
- Team issue lists must not leak issues from other teams.
- `GET /api/teams/:id/issues?labels=a,b` must return only issues that contain
  all requested labels.
- Comments are returned oldest first.

Team summary response:

```json
{
  "teamId": "string",
  "todoCount": 1,
  "doingCount": 1,
  "doneCount": 0,
  "blockedCount": 0,
  "issueIds": ["issue-id"]
}
```

