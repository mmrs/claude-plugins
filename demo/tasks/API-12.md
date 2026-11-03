# API-12: Add due dates to tasks

- [x] Add a nullable `due_date` column with a migration
- [x] Accept `dueDate` on create and update
- [x] Reject due dates in the past with a 400
- [x] Return `dueDate` in the task response
- [ ] Check on staging after deploy
