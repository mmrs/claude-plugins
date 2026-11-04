Add due dates to tasks in todo-api (API-12). You're on this as the Snr. Developer because it adds a migration and touches validation every endpoint shares.

What to build: a nullable `due_date` column, `dueDate` accepted on create and update, and `dueDate` returned in the task response.

Where it goes and why:
- The migration is the next Flyway version, `V7__task_due_date.sql`. Never edit V1 to V6: they've run on staging.
- Validation goes on `TaskRequest` with Bean Validation annotations, the way `title` is validated there. Don't add checks in `TaskController`.
- `dueDate` is an ISO date (`2026-11-30`), `LocalDate` in Java, no time part.

Out of scope: reminders and the web app (that's WEB-7).

Rules this change is most likely to break, so check your diff against them before you finish:
- Request and response DTOs stay in `todo/task/dto`, not next to the service.
- Errors go through `ApiExceptionHandler`, so a validation failure has the same JSON shape as a blank title.
- No request bodies in log lines.

Run `./mvnw -q test` and make it pass before you stop. Don't commit.

End with a short report: the files you changed and why, each rule above and how the diff keeps it, the command you ran and its result, and anything you left open.
