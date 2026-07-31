-- ⚠️ DESTRUCTIVE: drops all tables. Hanya jalankan kalau mau reset total.
drop view if exists md_monthly_performance cascade;
drop view if exists visit_details cascade;
drop table if exists visits cascade;
drop table if exists bengkels cascade;
drop table if exists kotas cascade;
drop table if exists distributors cascade;
drop table if exists regions cascade;
drop table if exists profiles cascade;
drop type if exists visit_status cascade;
drop type if exists user_role cascade;
drop function if exists handle_new_user() cascade;
drop function if exists set_updated_at() cascade;
drop function if exists get_user_role() cascade;
drop function if exists is_admin() cascade;
