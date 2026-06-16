-- 0018_seed_equipment_master.sql
-- 장비 마스터 초기 시드 (광동제약 QC 보유 기기)
-- ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 0017 적용 후 실행하세요.
--
-- code 는 test_capabilities.code / test_item_equipment.required_equipment 토큰과 일치시켜
-- 작업 시작 시 checkEquipmentReadiness 가 자동 매칭되도록 설계함.
-- (resolveOrderEquipmentCodes 는 '_'를 보존하므로 복합코드(UV_VIS 등)도 그대로 매칭)
--
-- 검교정일(calibration_date)/차기검교정일(calibration_due_date)은 예시값이며,
-- 운영 전 실제 검교정 이력으로 갱신하세요. 모든 차기일은 미래로 설정해 작업이 차단되지 않습니다.

INSERT INTO equipment_master (code, name, category, status, calibration_date, calibration_due_date, location) VALUES
  ('HPLC',          '고성능 액체크로마토그래프 (HPLC)',     '크로마토그래피', 'active', '2026-02-10', '2026-08-10', '기기분석실'),
  ('UHPLC',         '초고성능 액체크로마토그래프 (UHPLC)',  '크로마토그래피', 'active', '2026-03-05', '2026-09-05', '기기분석실'),
  ('SHIMADZU_HPLC', '시마즈 HPLC',                          '크로마토그래피', 'active', '2026-01-20', '2026-07-20', '기기분석실'),
  ('GC',            '가스 크로마토그래프 (GC)',             '크로마토그래피', 'active', '2026-04-01', '2026-10-01', '기기분석실'),
  ('TLC',           '박층크로마토그래피 스캐너 (TLC)',      '크로마토그래피', 'active', '2026-03-12', '2026-09-12', '이화학실'),
  ('GCMS',          'GC-질량분석기 (GC-MS)',                '질량분석',       'active', '2026-03-15', '2026-09-15', '질량분석실'),
  ('GCMS_TQ',       'GC-MS/MS (삼중사극자)',                '질량분석',       'active', '2026-02-28', '2026-08-28', '질량분석실'),
  ('LCMS_TQ',       'LC-MS/MS (삼중사극자)',                '질량분석',       'active', '2026-04-10', '2026-10-10', '질량분석실'),
  ('FTIR',          '푸리에변환 적외선분광기 (FT-IR)',      '분광',           'active', '2026-05-02', '2026-11-02', '기기분석실'),
  ('UV_VIS',        '자외선-가시광선 분광광도계 (UV-Vis)',  '분광',           'active', '2026-05-20', '2026-11-20', '기기분석실'),
  ('FLUORESCENCE',  '형광광도계',                           '분광',           'active', '2026-04-22', '2026-10-22', '기기분석실'),
  ('TOC',           '총유기탄소 분석기 (TOC)',              '이화학',         'active', '2026-03-30', '2026-09-30', '이화학실'),
  ('MOISTURE',      '칼-피셔 수분측정기',                   '이화학',         'active', '2026-04-18', '2026-10-18', '이화학실'),
  ('POTENTIOMETER', '전위차 적정기',                        '이화학',         'active', '2026-02-05', '2026-08-05', '이화학실'),
  ('CONDUCTIVITY',  '전기전도도계',                         '이화학',         'active', '2026-05-25', '2026-11-25', '이화학실'),
  ('PH',            'pH 미터',                              '이화학',         'active', '2026-06-01', '2026-12-01', '이화학실'),
  ('DISSOLUTION',   '용출시험기',                           '물성',           'active', '2026-05-11', '2026-11-11', '제제시험실')
ON CONFLICT (code) DO NOTHING;
