-- Optional synthetic core banking fixtures for the onboarding training database.
-- Apply while the API is stopped: sqlite3 data/onboarding.sqlite < data/seed-core-members.sql
INSERT OR IGNORE INTO core_members (id,member_number,phone_number,id_number,first_name,last_name,date_of_birth,email,branch,account_type,account_number,status) VALUES
('training-seed-001','MBR-200001','+254711200001','39200001','Nadia','Wekesa','1991-02-14','nadia.wekesa@example.test','Kisumu','personal','0112345680001','active'),
('training-seed-002','MBR-200002','+254711200002','39200002','Eric','Mutua','1986-07-09','eric.mutua@example.test','Machakos','business','0112345680002','active'),
('training-seed-003','MBR-200003','+254711200003','39200003','Zawadi','Kilonzo','1994-10-22','zawadi.kilonzo@example.test','Mombasa','personal','0112345680003','active'),
('training-seed-004','MBR-200004','+254711200004','39200004','Mark','Omondi','1989-12-03','mark.omondi@example.test','Nairobi CBD','joint','0112345680004','active'),
('training-seed-005','MBR-200005','+254711200005','39200005','Esther','Cheruiyot','1996-05-17','esther.cheruiyot@example.test','Eldoret','personal','0112345680005','active');
