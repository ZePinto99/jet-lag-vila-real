-- Migration 0035: remove the pre-binding tag entry points. Only the 7-argument
-- bulk RPC that carries the route's exact camping heartbeat may mutate tags.

revoke all on function public.apply_tag_atomic(
  uuid, uuid, uuid, double precision, double precision, text
) from public, anon, authenticated, service_role;
drop function public.apply_tag_atomic(
  uuid, uuid, uuid, double precision, double precision, text
);

revoke all on function public.apply_tags_atomic(
  uuid, uuid[], uuid, double precision, double precision, text
) from public, anon, authenticated, service_role;
drop function public.apply_tags_atomic(
  uuid, uuid[], uuid, double precision, double precision, text
);
