-- App-controlled worker lifecycle: the admin starts/stops the companion worker
-- from Settings. worker_pid records the spawned process; stop_requested is a
-- cooperative kill switch the worker polls (robust even if the pid is stale).
alter table public.whatsapp_runtime add column if not exists worker_pid integer;
alter table public.whatsapp_runtime add column if not exists stop_requested boolean not null default false;
