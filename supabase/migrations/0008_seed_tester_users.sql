-- ============================================================
-- 0008_seed_tester_users.sql
-- 시험자(testers) 15명을 users 테이블에 사용자 계정으로 등록
-- 비밀번호는 모두 'qc1234' 로 통일 (bcrypt, pgcrypto crypt() 사용)
-- username 은 employee_no 기반으로 임의 부여 (예: kyo-16242)
-- display_name 은 시험자 실명 사용
-- ============================================================

-- pgcrypto는 0003에서 이미 활성화

INSERT INTO users (username, password_hash, display_name, role, is_active)
VALUES
  ('kyo-16242', crypt('qc1234', gen_salt('bf', 10)), '김태훈', 'user', true),
  ('kyo-17013', crypt('qc1234', gen_salt('bf', 10)), '박성호', 'user', true),
  ('kyo-21083', crypt('qc1234', gen_salt('bf', 10)), '권택균', 'user', true),
  ('kyo-16167', crypt('qc1234', gen_salt('bf', 10)), '장재훈', 'user', true),
  ('kyo-16185', crypt('qc1234', gen_salt('bf', 10)), '지건희', 'user', true),
  ('kyo-16218', crypt('qc1234', gen_salt('bf', 10)), '김기호', 'user', true),
  ('kyo-20028', crypt('qc1234', gen_salt('bf', 10)), '이영남', 'user', true),
  ('kyo-20052', crypt('qc1234', gen_salt('bf', 10)), '안성은', 'user', true),
  ('kyo-20106', crypt('qc1234', gen_salt('bf', 10)), '임수민', 'user', true),
  ('kyo-21084', crypt('qc1234', gen_salt('bf', 10)), '김태환', 'user', true),
  ('kyo-23018', crypt('qc1234', gen_salt('bf', 10)), '박윤진', 'user', true),
  ('kyo-26046', crypt('qc1234', gen_salt('bf', 10)), '정예찬', 'user', true),
  ('kyo-23040', crypt('qc1234', gen_salt('bf', 10)), '이원재', 'user', true),
  ('kyo-26055', crypt('qc1234', gen_salt('bf', 10)), '김정호', 'user', true),
  ('kyo-24084', crypt('qc1234', gen_salt('bf', 10)), '강지윤', 'user', true)
ON CONFLICT (username) DO NOTHING;
