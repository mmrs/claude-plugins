Paginate GET /tasks in todo-api (API-15). You're on this as the Developer: it follows a pattern the codebase already has and needs no migration.

What to build: `page` and `size` query parameters on GET /tasks, and the total count in the response.

Where it goes and why:
- Take a Spring Data `Pageable` in `TaskController.list` and return a `Page`, the way `ProjectController.list` does. Reuse its `PageResponse` DTO rather than writing a second one.
- The default page size is still an open question with the user. Use 20 for now, in one constant `DEFAULT_PAGE_SIZE` next to the controller, so changing it to 50 is a one-line follow-up.
- Cap `size` at 100, as `ProjectController` does.

Out of scope: sorting and filtering.

Rules this change is most likely to break, so check your diff against them before you finish:
- Response DTOs stay in `todo/task/dto`.
- The existing GET /tasks tests keep passing unchanged; the web app reads the current response shape.

Run `./mvnw -q test` and make it pass before you stop. Don't commit.

End with a short report: the files you changed and why, each rule above and how the diff keeps it, the command you ran and its result, and anything you left open.
