-- Cockpit Dr Amraoui — migration 007 : conclusion d'examen (tout type).
alter table examens add column if not exists conclusion text;
