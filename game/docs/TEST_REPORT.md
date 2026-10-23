# WARGRID — Báo cáo kiểm thử QA

Ngày test: 2026-10-23 · Người test: agent QA (chơi thử trên trình duyệt + chạy headless) · Không sửa code trong `src/`.

> Lưu ý: trong lúc test, các agent khác vẫn đang sửa `src/` (ví dụ `src/sim/transport.js`, `src/ui/tutorial.js` đổi trong lúc chạy), nên một vài số liệu headless có thể lệch nhẹ giữa các lần chạy. Mọi lỗi dưới đây đều đã tái hiện lại ở bản code mới nhất lúc viết báo cáo.
> Pane trình duyệt bị ẩn nên `requestAnimationFrame` gần như dừng; mô phỏng được đẩy nhanh bằng `game.step()` và khung hình được vẽ bằng cách gọi `__match.loop()` thủ công. Ảnh chụp đôi khi là khung hình cũ — các kết luận đều được kiểm tra lại bằng DOM/JS.

## 1. Lệnh đã chạy và tổng kết

| Lệnh | Tổng | Đạt | Lỗi | Bỏ qua |
|---|---|---|---|---|
| `node --test tests/*.test.mjs` (toàn bộ, gồm test QA mới) | 135 | 131 | 4 | 0 |
| ├ trong đó `tests/qa-sim.test.mjs` (quét 3 bản đồ × 5 chỉ huy, kiểm tra bất biến) | 15 | 15 | 0 | 0 |
| └ trong đó `tests/qa-bugs.test.mjs` (tái hiện lỗi, 4 test "BUG" đều lỗi đúng như dự kiến) | 8 | 4 | 4 | 0 |
| `node tests/qa-balance.mjs` (120 trận AI vs AI, mọi cặp chỉ huy × 3 bản đồ × 2 seed) | 120 trận | không lỗi JS | — | — |
| `node tests/sim-harness.mjs 600 plains steel air` | 1 trận | OK (1,8 s thời gian thực) | — | — |
| Kiểm thử trình duyệt + headless thủ công (bảng mục 2) | 88 | 68 | 20 | 0 |

4 test bị lỗi trong `node --test` đều là test tái hiện lỗi (tên bắt đầu bằng `BUG:`), **lỗi đúng như mong đợi** — không có test nào lỗi ngoài dự kiến. 102 test có sẵn của dự án đều đạt.

File log / kết quả:
- `tests/logs/all-tests.log` — toàn bộ `node --test`
- `tests/logs/unit-tests.log` — lần chạy đầu (102/102 đạt)
- `tests/logs/qa-sim.log`, `tests/logs/qa-sim-report.json` — quét bất biến
- `tests/logs/qa-bugs.log` — test tái hiện lỗi
- `tests/logs/qa-balance.log` — 120 trận cân bằng + tỉ lệ thắng
- File test mới: `tests/qa-sim.test.mjs`, `tests/qa-bugs.test.mjs`, `tests/qa-lib.mjs` (helper), `tests/qa-balance.mjs` (script)

Ảnh chụp (lưu tự động): thư mục `C:\Users\ADMIN\.claude\projects\D--HoangKiet-armywwar\0a5e8f45-8558-40ab-a689-b1dc4c7e435f\tool-results\` — tên file ghi ở cột "Bằng chứng" (tiền tố `mcp-Claude_Browser-blob-`).

## 2. Bảng test case

### A. Menu & meta

| # | Tên | Kết quả | Mong đợi → Thực tế | F-xx |
|---|---|---|---|---|
| A1 | Menu chính tải được (logo, tên, nút) | PASS | Logo, "WARGRID: Chỉ Huy AI", 6 nút, nhiệm vụ ngày → đúng (`1792757939588-ad4sbx.jpg`) | F-01 |
| A2 | Gợi ý bước 1 trỏ vào "Hướng dẫn chơi" | PASS | Khung sáng đúng nút; lưu ý bong bóng che 3 nút "Chơi nhanh / Boss / Đấu data" ở 1024×768 | F-190 |
| A3 | Chọn chỉ huy: 5 thẻ + Phó tướng bị khóa | PASS | 5 thẻ có học thuyết/thế mạnh/điểm yếu/thụ động/tối thượng/thưởng tier; thẻ Phó tướng `disabled` (`1792758272472-jr3vho.jpg`) | F-20..F-26 |
| A4 | Xếp đội hình: thêm/bỏ/đổi số lượng | PASS | Thêm, ✕, +/− hoạt động; tank tối đa x4 | F-04 |
| A5 | Giới hạn 30 CP | PASS | Ở 30/30 bấm + / thêm đơn vị → toast "Vượt giới hạn điểm chỉ huy" | F-110 |
| A6 | Tối đa 9 ô | PASS | 9/9; bấm thêm thì thay ô đang chọn (không vượt 9) | F-52 |
| A7 | Tối đa 3 T3 | PASS | T3 thứ 4 → toast "Tối đa 3 đơn vị T3" (lưu ý: 1 ô tank x2 ở T3 chỉ tính là 1) | F-82 |
| A8 | Ngân sách 1 tỷ + vay trước trận | PASS | Khu trục 2,2 tỷ bị chặn; vay 2 tỷ → được thêm, hiển thị nợ 2,24 tỷ; giảm vay khi vượt ngân sách bị chặn | F-170..F-172 |
| A9 | "Đề xuất" cho 5 chỉ huy | PASS | Cả 5 hợp lệ (CP ≤ 30, ngân sách đúng). Nhưng xem lỗi #2 (hải quân vay 2 tỷ) và #23 (EW còn 2 tr) | F-04 |
| A10 | Chọn bản đồ: 3 bản đồ + gợi ý lợi/hại cho đội hình | FAIL | Mong đợi gợi ý khớp mô tả; thực tế Thành phố ghi "Hạn chế: Tank nặng" nhưng không cảnh báo đội tank, Vịnh biển ghi "bộ binh" nhưng không cảnh báo (`1792758347822-nnug8k.jpg`) | F-90..F-92 |
| A11 | Vào trận đúng bản đồ / chỉ huy / tiền | PASS | bay + steel, tiền 843 tr = 1 tỷ − 157 tr đội hình; địch counter = swarm | F-170 |
| A12 | Màn Chiến dịch Boss: 4 boss, khóa theo thứ tự | PASS | Chương 2–4 khóa, bấm → toast "Chương này chưa mở khóa" (`1792759197399-182yex.jpg`) | F-100 |
| A13 | Đấu data khóa đến khi hạ 4 boss | PASS | Khóa + toast; sau khi hạ đủ 4 boss → nút mở, vào được danh sách 8 data | F-102 |
| A14 | Hồ sơ & Nhiệm vụ | PASS | Nhiệm vụ, tiến trình boss, bảng tỉ lệ thắng, skin, battle pass, nhận thưởng (`1792759565246-siulel.jpg`) | F-111..F-114 |
| A15 | Màn kết quả thắng / thua | PASS | "CHIẾN THẮNG"/"THẤT BẠI", lý do, chỉ số, phần thưởng, nhiệm vụ (`1792759167926-om4idk.jpg`, `1792759274440-dxe96j.jpg`) | F-150..F-156 |
| A16 | Chơi lại / Về menu | PASS | Chơi lại tạo trận mới cùng cấu hình; Về menu ẩn HUD, về menu | — |
| A17 | Tiêu đề bước của luồng Boss / Đấu data | FAIL | Mong đợi đúng số bước; thực tế ghi "Bước 1/3", "Bước 2/3" nhưng không có bước 3 (bản đồ cố định) | — |

### B. Hướng dẫn (yêu cầu chính)

| # | Tên | Kết quả | Mong đợi → Thực tế | F-xx |
|---|---|---|---|---|
| B1 | Bước 1 (menu) → "Vào trận tập" | PASS | Click thật → vào trận `mode: tutorial` | F-190 |
| B2 | Bước 2: khung sáng ô đầu tiên (xe tăng) trong khay triển khai | PASS | Khung đúng ô "Thiết Hổ MBT"; click → sang bước 3 (`1792757984437-89eu2u.jpg`) | F-190 |
| B3 | Bước 3: chỉ vùng triển khai xanh | FAIL | Mong đợi khung sáng bao vùng triển khai; thực tế khung = **toàn màn hình** (hole 984×748 px), không chỉ được chỗ nào; bong bóng nằm đè khay ô + minimap; vùng triển khai khó thấy (viền mảnh xanh nhạt, không phải "vùng xanh") (`1792757998128-6psux2.jpg`) | F-190, F-05 |
| B4 | Bước 3: đặt sai chỗ → toast + quay lại bước 2 | PASS | Toast "Ngoài vùng triển khai", quay về bước 2 | F-190 |
| B5 | Bước 3: đặt đúng → bước 4 | PASS | 2 xe tăng xuất hiện, sang bước 4 | F-190 |
| B6 | Bước 4: khung "Sẵn sàng" | PASS | Đúng nút; click → trận bắt đầu, sang bước 5 (`1792758026073-0qofkb.jpg`) | F-190 |
| B7 | Bước 5: khung quanh xe tăng | PASS | Khung 59 px đúng vị trí xe tăng; click → chọn cả nhóm (2 tank), sang bước 6 (`1792758041286-a845kj.jpg`) | F-190, F-02 |
| B8 | Bước 6: khung lệnh "Chiếm cứ điểm" | PASS | Đúng nút; click → bước 7 (`1792758053138-zy2yvr.jpg`) | F-190 |
| B9 | Bước 7: khung cứ điểm trung lập gần nhất | PASS | Đúng cứ điểm; click → lệnh capture cho 2 tank, bước 8 (`1792758086329-5uq32u.jpg`) | F-190 |
| B10 | Bước 8: thanh chiếm 15 giây → tự sang bước 9 | PASS | Chiếm xong (~15 s mô phỏng) → bước 9 | F-131, F-184 |
| B11 | Bước 9: khung nút Cửa hàng + Khí tài; S/B mở được | FAIL | Khung đúng nút, S/B mở được; nhưng **lớp hướng dẫn (z-index 60) nằm trên modal Cửa hàng (z-index 40)**: bong bóng + khung che nội dung shop, khung trỏ vào nút bị modal che (`1792758145718-5ujeek.jpg`, `1792758156827-q51qqa.jpg`) | F-190, F-180 |
| B12 | Bước 10: khung minimap; Z/X, Q/E, mũi tên, click minimap | PASS | Khung đúng minimap; zoom 3 mức, xoay 4 hướng, pan, nhảy camera đều chạy (`1792758170973-43mv0i.jpg`) | F-09, F-10 |
| B13 | Bước 11: khung lệnh tối thượng; "Hoàn thành" | PASS | Khung đúng nút "Miệng Chôn"; hoàn thành → toast, `tutorialDone = true` (`1792758191863-wep045.jpg`) | F-190 |
| B14 | Nút "Bỏ qua" | PASS | Tắt lớp hướng dẫn ngay, trận vẫn chạy | F-190 |
| B15 | Thưởng 300 vàng lần đầu hoàn thành trận tập | FAIL | Mong đợi +300🪙; thực tế 0 vì `Tutorial.finish()` đặt `tutorialDone=true` trước khi `applyMatchResult` chạy (test `qa-bugs` #4) | F-190 |
| B16 | Gợi ý menu sau khi bấm "Bỏ qua" | FAIL | Mong đợi không hiện lại; thực tế hiện lại mỗi lần quay về menu chính cho đến khi chơi trận tập | F-190 |
| B17 | Thoát trận tập về menu sau khi xong | FAIL | Thông báo bảo "thoát ra menu để chơi thật" nhưng **không có nút thoát/tạm dừng**, chỉ có "Đầu hàng" | F-190 |

### C. Trong trận

| # | Tên | Kết quả | Mong đợi → Thực tế | F-xx |
|---|---|---|---|---|
| C1 | Đếm ngược triển khai 30 s | PASS | "TRIỂN KHAI 30s" giảm dần | F-05 |
| C2 | Click ô → click bản đồ để đặt | PASS | Đặt đúng vị trí | F-05 |
| C3 | Đặt sai (tank xuống nước) → toast | PASS | "Đơn vị mặt đất phải đặt trên đất liền" (lưu ý: ô vẫn sáng "active" dù đã hủy chọn) | F-05 |
| C4 | Tự động triển khai | PASS | 9/9 ô đã đặt | F-05 |
| C5 | Sẵn sàng | PASS | Vào pha chiến đấu | F-03 |
| C6 | Zoom 3 mức (Z/X, lăn chuột) | PASS | 0↔1↔2 ở trận đầu tiên | F-10 |
| C7 | Lăn chuột sau khi đã chơi ≥ 2 trận | FAIL | Mong đợi 1 nấc/lần lăn; thực tế trận thứ 2 nhảy 2 nấc (0→2), càng nhiều trận càng nhảy nhiều — listener canvas của các trận cũ không bị gỡ | F-10 |
| C8 | Xoay 4 hướng (Q/E) | PASS | yawIndex 0..3 | F-09 |
| C9 | Pan bằng phím mũi tên / kéo chuột phải / kéo 1 ngón | PASS | target camera thay đổi | F-09 |
| C10 | Click minimap | PASS | Camera nhảy tới điểm | F-185 |
| C11 | Click 1 đơn vị → chọn cả nhóm; phím 1–9; kéo khung chọn; click đất trống bỏ chọn | PASS | Đều đúng | F-02, F-06 |
| C12 | 9 lệnh trên thanh lệnh đổi hành vi | PASS | move/attack/defend/suppress/flank/sead/focus/capture/retreat → `order` và `intent` đổi, quãng đường di chuyển hợp lý (suppress đứng yên, retreat về căn cứ) | F-61..F-67 |
| C13 | Icon ý định + vòng tầm bắn | PASS | Có icon trên đầu và vòng tầm bắn khi chọn (`1792758455233-a1c3n3.jpg`) | F-69, F-183 |
| C14 | Chiếm cứ điểm 15 s, bị tranh chấp thì dừng; máy bay không chiếm | PASS | Test headless `qa-bugs` #1–#3 đạt | F-131..F-133 |
| C15 | Xe chở quân thả bộ binh | PASS | 300 s headless: 37 lần đón, 30 lần thả, 30 tổ bộ binh | F-141, F-142 |
| C16 | Cửa hàng: mua, nâng tier, tuyển quân, tổng động viên, vay, trả nợ, bán | PASS | Tất cả đổi state đúng + toast tiếng Việt | F-165, F-166, F-174, F-175, F-177, F-180 |
| C17 | Danh sách khí tài (B) | PASS | Ô, SL, tier, HP, đạn, đang làm gì | F-181 |
| C18 | Lệnh tối thượng R cho cả 5 chỉ huy | PASS | Miệng Chôn (khiên + tăng tốc), Mưa Thép, Phong Tỏa, Đàn Ong (sinh 5 bầy), Màn Đêm (3 địch bị nhiễu) — trừ CP, hồi chiêu đúng; Esc/chuột phải hủy (`1792759111745-3y6k1q.jpg`) | F-23 |
| C19 | Tên lửa siêu thanh T (xác nhận) | PASS | Hộp xác nhận, trừ 40 tr, HQ địch 12000→10544, hồi 150 s | F-46, F-70 |
| C20 | Đầu hàng (hộp xác nhận) | PASS | Kết thúc trận, thua | F-154 |
| C21 | HUD góc màn hình cập nhật | PASS | Lính, tiền, thu-chi/phút, nợ + đếm ngược, CP, điểm 2 bên, cứ điểm, hạ/mất | F-163, F-182 |
| C22 | Bảng "Đã chọn" nhìn thấy được | FAIL | Ở 1024×768 bảng `#selection-panel` (x 624–874) bị thanh lệnh (x 260–764) che gần hết; xảy ra với mọi màn hình rộng < ~1300 px | F-182 |
| C23 | Bảng "Đã chọn" khi sang trận mới | FAIL | Bảng của trận trước (vd "Thiết Hổ MBT ×2") vẫn hiện trong pha triển khai trận sau, che ô thứ 9 (`1792758362831-3d3vqs.jpg`) | — |
| C24 | Thoát trận về menu không cần đầu hàng | FAIL | Không có nút menu/tạm dừng trong trận | F-17 |

### D. Bản đồ × chỉ huy (headless + trình duyệt)

| # | Tên | Kết quả | Mong đợi → Thực tế | F-xx |
|---|---|---|---|---|
| D1 | Quét bất biến 15 trận (3 map × 5 chỉ huy): không exception, không NaN, không ra ngoài map, không kẹt | PASS | 15/15 đạt (`tests/logs/qa-sim-report.json`) | F-90..F-93 |
| D2 | Đơn vị mặt đất luôn ở trên đất / tàu ở dưới nước | FAIL | Bộ binh do trực thăng thả xuất hiện **dưới nước** (vd plains cứ điểm 3 ở bờ sông, (119.9, 62.7)); test `qa-bugs` #6 | F-134 |
| D3 | Không thiếu mô hình (hộp tím) | PASS | Sinh đủ 27 loại đơn vị + công trình: 0 hộp tím (`1792759531816-imdv7x.jpg`) | F-11 |
| D4 | Không lộ sương chiến trường khi vẽ | PASS | 3 trận × 240 s, 3818 lần kiểm tra: 0 mesh địch hiện khi `visible=false`; máy bay địch ẩn khi ngoài radar, tàu ngầm ẩn khi ngoài sonar | F-15, F-94 |
| D5 | Cân bằng chỉ huy (mục tiêu 45–55%) | FAIL | 120 trận: Thép 88–100%, EW 63–69%, Không quân 31–50%, Swarm 31–50%, **Hải quân 0–19% (kể cả Vịnh biển)** | F-114, F-16 |
| D6 | "Đề xuất" Hải quân không tự dẫn tới phá sản | FAIL | Đề xuất tự vay 2 tỷ (trả 2,24 tỷ ở phút ~8) → 3/4 trận phá sản lúc t=510 s; cả 12/120 trận phá sản trong quét cân bằng đều là hải quân | F-174..F-176 |
| D7 | Thời lượng trận 8–12 phút | FAIL | Trung bình ~5,9 phút (AI vs AI); nhiều trận kết thúc đúng 8:25 do AI đầu hàng (480 s + 25 s) | F-16 |
| D8 | Đồ họa Thành phố dễ đọc | FAIL (thấp) | Mặt tường nhà tối với chấm dày, mái kiểu ô vuông có lỗ, mưa — đơn vị rất khó thấy (`1792759575469-amrkcs.jpg`, `1792759610137-gy71sk.jpg`) | F-90, F-120 |
| D9 | Lỗi JS trong console | PASS | Không có lỗi JS trong suốt phiên; chỉ có 12 lỗi 404 ở lần tải đầu (không lặp lại sau khi tải lại) | — |

### E. Boss & Đấu data

| # | Tên | Kết quả | Mong đợi → Thực tế | F-xx |
|---|---|---|---|---|
| E1 | Boss 1 Tàu sân bay (Vịnh biển): 3 pha + banner + hạ boss thắng | PASS | Pha 1 lá chắn → banner "PHA 2: GỌI VIỆN" (2 đợt viện) → pha 3 → hạ boss "CHIẾN THẮNG", mở chương 2 | F-100, F-101, F-08 |
| E2 | Boss 2 Thành đài phòng không (Đồng bằng) | PASS | pha [2,3], thắng, mở chương 3 | F-100 |
| E3 | Boss 3 Tàu ngầm chiến lược (Vịnh biển) | PASS | pha [2,3], thắng, mở chương 4 | F-100 |
| E4 | Boss 4 Thành phố AI (Thành phố) | PASS | pha [2,3], thắng, "Mở khóa chế độ Đấu data!" | F-100, F-102 |
| E5 | Thanh máu boss không che HUD | FAIL | `#boss-bar` đè lên bảng trái: tiền "417 tr USDT" và nợ "560 tr · 8…" bị cắt (`1792759222527-7hke1q.jpg`) | F-182 |
| E6 | Đấu data: danh sách + lọc hạng/chỉ huy/ngẫu nhiên | PASS | 8 data mồi, lọc chỉ huy còn 2 | F-104 |
| E7 | Đấu data: replay chuỗi lệnh | PASS | Tag "⚔ Đấu data…", địch `ai:false`, 180 s chạy 32 lệnh đã lưu | F-105 |
| E8 | Thắng Chơi nhanh lưu snapshot | PASS | Kho data thêm 1 snapshot "của bạn" | F-103 |

### F. Điều kiện thắng/thua (trong trình duyệt, màn kết quả)

| # | Tên | Kết quả | Mong đợi → Thực tế | F-xx |
|---|---|---|---|---|
| F1 | Phá HQ địch → thắng | PASS | "Thành chỉ huy của Phe Đỏ đã bị phá hủy" | F-150 |
| F2 | HQ mình bị phá → thua | PASS | Có (câu chữ: "Thành chỉ huy của **Chỉ huy** đã bị phá hủy" — tên mặc định người chơi là "Chỉ huy" nên đọc khó hiểu) | F-153 |
| F3 | Đầu hàng | PASS | "Chỉ huy đã đầu hàng" | F-151, F-154 |
| F4 | Hết 1 giờ → điểm cao hơn thắng | PASS | "Hết 1 giờ — … (100 – 50)" | F-152 |
| F5 | Hết giờ hòa điểm → nhiều lính hơn thắng | PASS | "… còn nhiều binh lính hơn (2000 – 1500)" | F-152 |
| F6 | Hết binh lính | PASS | "Chỉ huy đã hết binh lính" | F-155 |
| F7 | Vỡ nợ (vay 1 tỷ, tiêu hết, quá hạn) | PASS | 5 lần thanh lý bán khí tài rồi "phá sản" | F-156, F-175, F-176 |

### G. Mobile (375×812, chạm)

| # | Tên | Kết quả | Mong đợi → Thực tế | F-xx |
|---|---|---|---|---|
| G1 | Menu trên mobile | PASS | Một cột, không cuộn ngang (`1792759331621-rqbt0t.jpg`) | F-17 |
| G2 | Khay triển khai trên mobile | FAIL | `#deploy-panel` chỉ rộng **95 px** (`max-width: calc(100vw - 280px)`) → 1 cột dọc từ y = −351 đến 804: 3 ô đầu nằm ngoài màn hình, không chạm được; che giữa màn hình (`1792759351588-1y45ye.jpg`) | F-17, F-185 |
| G3 | HUD + thanh lệnh trên mobile | FAIL | Thanh lệnh 2 cột chồng lên nút Tối thượng/Tên lửa; chữ HUD tràn ("1.00 tỷ USDT", "+1.7 tr" bị cắt); minimap bị ẩn (`1792759364147-actn6c.jpg`) | F-17, F-182 |
| G4 | Chạm chọn / chạm ra lệnh / kéo 1 ngón pan | PASS | Chọn được tank, lệnh move đúng, camera pan | F-17 |

### H. Hiệu năng (pane ẩn — đo thời gian `R.render` + `gl.finish()`, trung vị 20 khung, chất lượng post "high")

| # | Tên | Kết quả | Số liệu | F-xx |
|---|---|---|---|---|
| H1 | Bản đồ trống (zoom chiến lược) | PASS | draw call: Đồng bằng 382, Thành phố 692, Vịnh 395 | F-122 |
| H2 | Trận lớn ~75 đơn vị sống, zoom chiến lược | FAIL (trung bình) | Đồng bằng 21,2 ms (p90 31,6), 4147 draw call, 0,9 tr tam giác · Thành phố 26,1 ms (p90 34,3), 4575 call · Vịnh 24,4 ms (p90 32,4), 4343 call. Chiến thuật/cận cảnh: 16–31 ms, 3300–4600 call. ≈ 50 draw call / đơn vị | F-122 |

Tổng bảng mục 2: 88 case — 68 PASS, 20 FAIL (A 15/2, B 12/5, C 20/4, D 4/5, E 7/1, F 7/0, G 2/2, H 1/1).

## 3. Danh sách lỗi theo mức độ

### Cao
1. **Mobile: khay triển khai không dùng được** (G2, G3). Repro: `resize_window` 375×812 → tải lại → Chơi nhanh/`?quick=1` → pha triển khai: khay là 1 cột 95 px, 3 ô đầu ở y<0. Sang chiến đấu: thanh lệnh đè nút tối thượng, chữ HUD tràn. Nghi ngờ: `src/ui/style.css` (`#deploy-panel { max-width: calc(100vw - 280px) }`, khối `@media (max-width: 820px)` cho `#command-bar`, `#hud-left`, `#hud-side`).
2. **"Đề xuất" Hải quân tự vay 2 tỷ → phá sản ở phút 8; Hải quân gần như không thắng** (D5, D6). Repro: `node --test tests/qa-bugs.test.mjs` (test "Đề xuất … Hải quân") hoặc Chơi nhanh → Đô đốc Hải quân → ★ Đề xuất (toast "kèm khoản vay 2.00 tỷ") → chơi tới 8:00. Tỉ lệ thắng 120 trận: Thép 88–100%, Hải quân 0–19%. Nghi ngờ: `src/core/profile.js` `recommendWithLoan` (chấm điểm chỉ theo số đơn vị đề xuất, không xét khả năng trả nợ), `src/data/commanders.js` (danh sách recommended của navy), cân bằng trong `src/sim/economy.js`/`src/data/units.js`.

### Trung bình
3. **Lăn chuột zoom nhảy nhiều nấc sau khi chơi ≥ 2 trận** (C7). Repro: tải trang → `__app.startMatch(defaultMatch())` 2 lần → `R.setZoom(0)` → lăn chuột 1 lần → zoomIndex = 2. Nguyên nhân: `Input.dispose()` không gỡ listener `wheel`/`pointerdown`/`contextmenu`/`pointerenter`/`pointerleave` trên canvas dùng chung. File: `src/ui/input.js`.
4. **Bảng "Đã chọn" bị thanh lệnh che ở màn hình < ~1300 px** (C22). Repro: 1024×768 hoặc 1280×720, chọn nhóm bất kỳ → chỉ thấy mép "2 T1" bên phải thanh lệnh. File: `src/ui/style.css` (`#selection-panel { right:150px }` vs `#command-bar { max-width: calc(100vw - 520px) }`).
5. **Bảng "Đã chọn" của trận trước còn hiện ở trận sau** (C23). Repro: chọn nhóm trong trận → đầu hàng → Chơi nhanh trận mới: bảng cũ hiện trong pha triển khai, che ô thứ 9. File: `src/ui/hud.js` (constructor không gọi `renderSelection()`, `dispose()` không ẩn `#selection-panel`).
6. **Thanh máu boss đè HUD trái** (E5). Repro: Chiến dịch Boss → chương 1 → vào trận ở 1024×768: tiền/nợ bị cắt. File: `src/ui/screens.js` `attachMatch` + CSS `#boss-bar` trong `src/ui/style.css`.
7. **Hướng dẫn bước 3 không chỉ ra vùng triển khai** (B3). Repro: Hướng dẫn chơi → click ô xe tăng → bước 3: khung sáng phủ cả màn hình (camera chiến thuật làm vùng 42×134 lấp đầy viewport), bong bóng đè khay ô. Nên zoom ra/thu khung về phần vùng nhìn thấy, tô màu vùng triển khai rõ hơn. File: `src/ui/tutorial.js` (`zoneRect`, `enter` của bước `zone`), `src/render/world.js` (`deployZone` mờ).
8. **Lớp hướng dẫn nằm trên modal Cửa hàng/Khí tài** (B11). Repro: tới bước 9 → bấm S: bong bóng + khung đè lên shop. File: `src/ui/style.css` (`#tutorial` z-index 60 > `#modal` 40) / `src/ui/tutorial.js` (nên ẩn hoặc hạ overlay khi `modalOwner()` khác null).
9. **Không có nút thoát/tạm dừng trong trận** (B17, C24). Muốn về menu phải "Đầu hàng" (trận Chơi nhanh bị tính thua, −15 hạng). File: `src/ui/hud.js` `buildButtons`.
10. **Hiệu năng: ~50 draw call / đơn vị** (H2). 75 đơn vị → 4000–4600 draw call, 16–31 ms/khung (chưa tính sim). Bầy drone/trận đông sẽ tụt fps. Nghi ngờ: `src/render/world.js`, `src/render/models.js` (GLB nhiều mesh con, không instancing), thanh máu/icon/x-ray từng đơn vị trong `src/render/fx.js`, shadow pass vẽ lại toàn bộ.

### Thấp
11. **Mất thưởng 300 vàng trận tập** (B15). `src/ui/tutorial.js` `finish()` lưu `tutorialDone=true` trước khi `src/core/profile.js` `applyMatchResult` kiểm tra `!p.tutorialDone`. Test `qa-bugs` #4.
12. **Gợi ý menu bước 1 hiện lại sau khi "Bỏ qua"** (B16). `src/ui/tutorial.js` `showMenuHint` → `onSkip` chỉ ẩn, không lưu.
13. **Bộ binh trực thăng thả xuống nước** (D2). `src/sim/transport.js` `spawnInfantry` không dùng `nearestPassable`. Test `qa-bugs` #6 (vd (127.4, 10.5) trên Đồng bằng).
14. **Gợi ý bản đồ sai dữ liệu** (A10). `src/data/maps.js`: city `limitedGroups` thiếu `tank`, bay thiếu `infantry` (và city `favoredGroups` thiếu trực thăng/`air`). Test `qa-bugs` #7.
15. **Thời lượng trận ngắn** (D7): TB ~5,9 phút, AI đầu hàng đúng 8:25. `src/sim/victory.js` `AI_SURRENDER`, cân bằng sát thương.
16. **Ô triển khai vẫn sáng sau khi đặt sai** (C3). `src/match.js` `leftClick` xóa `pendingDeploy` nhưng `src/ui/hud.js` không vẽ lại khay.
17. **Edge-pan dùng vị trí chuột cũ (0,0)** khi con trỏ vào canvas mà chưa có `pointermove` → camera trôi sang trái (thấy khi test bằng click tự động). `src/ui/input.js` (`pointerenter` không cập nhật `mouse.x/y`).
18. **Câu chữ**: lý do kết thúc dùng tên mặc định "Chỉ huy" → "Thành chỉ huy của Chỉ huy đã bị phá hủy"; luồng Boss/Đấu data ghi "Bước 1/3, 2/3" nhưng chỉ có 2 bước (`src/ui/screens.js`, `src/sim/victory.js`). Lớp `menu-hint` không bị gỡ khỏi `#tutorial` khi vào trận tập (vô hại).
19. **Có thể lộ vị trí qua vệt đạn**: `src/render/fx.js` `onFire` vẽ vệt nếu ô đích nhìn thấy, kể cả khi kẻ bắn (tàu ngầm/tiêm kích tàng hình) đang ẩn → lộ vị trí. Cần quyết định thiết kế.
20. **Đồ họa Thành phố khó đọc** (D8): mặt tường tối nhiều chấm, mái ô vuông có lỗ, đơn vị chìm giữa nhà. `src/render/terrain.js` / mô hình building.
21. **Luật T3 tính theo ô**: 1 ô tank ×2 ở T3 chỉ tính 1 "đơn vị T3" (`validateFormation` trong `src/core/profile.js`) — cần xác nhận với GDD.
22. **"Đề xuất" EW tiêu 998 tr/1 tỷ** → vào trận còn ~2 tr, thu-chi âm (−496k/phút), không mua được gì.

## 4. Ghi chú môi trường
- Hồ sơ (`localStorage wargrid.profile.v1`) trong pane đã được **đặt lại mặc định** sau khi test (đã từng mở khóa 4 boss để test Đấu data). Kho Đấu data còn 1 snapshot "của bạn" do test thắng Chơi nhanh tạo ra.
- Viewport mobile đã trả về desktop.
