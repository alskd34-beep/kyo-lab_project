-- 사용자 프로필 사진 URL 저장
alter table users
  add column if not exists avatar_url text;
