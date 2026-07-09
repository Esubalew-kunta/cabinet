-- Cockpit Dr Amraoui — migration 009 : note libre sur une tâche (création).
alter table taches add column if not exists note text;
