-- Grant Level 4 Admin Console clearance to arshvirsk26@gmail.com
insert into public.admin_users (user_id)
select p.id
from auth.users u
join public.profiles p on p.id = u.id
where lower(u.email) = 'arshvirsk26@gmail.com'
on conflict (user_id) do nothing;
