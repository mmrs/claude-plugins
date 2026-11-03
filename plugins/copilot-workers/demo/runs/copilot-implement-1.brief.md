Add due dates to tasks in todo-api (API-12). You're the Snr. Developer on this because it adds a migration.

Add a nullable `due_date` column (Flyway, next version), accept `dueDate` on create and update, and return it in the task response. Follow how `TaskRequest` already validates `title`. Out of scope: reminders, the web app. Verify with `./mvnw test`.
