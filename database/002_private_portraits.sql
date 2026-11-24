-- Create the private heart-portraits bucket in Storage and upload the two PNG files.
begin;
create function heart_game.can_read_portraits() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from heart_game.members where user_id=auth.uid())
$$;
revoke all on function heart_game.can_read_portraits() from public, anon;
grant execute on function heart_game.can_read_portraits() to authenticated;
create policy heart_members_read_portraits on storage.objects for select to authenticated
using (bucket_id='heart-portraits' and name in ('avatar-player.png','avatar-wife.png')
       and (select heart_game.can_read_portraits()));
commit;
