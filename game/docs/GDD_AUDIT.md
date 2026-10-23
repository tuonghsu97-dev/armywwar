# Báo cáo kiểm tra tuân thủ GDD — WARGRID: Chỉ Huy AI

Ngày kiểm tra: 2026-10-23 · Người kiểm tra: GDD compliance auditor (chỉ đọc code, không sửa `src/`).
Nguồn chuẩn: `GDD – Game MOBA chiến thuật 2.5D .pdf` (14 trang, đã đọc toàn bộ). Checklist: `docs/GDD_CHECKLIST.md` (đã cập nhật ô trạng thái + ghi chú).

## 1. Tổng kết

| Trạng thái | Số mã |
|---|---|
| [x] Xong, đúng GDD | **128** |
| [~] Làm đơn giản hóa | **16** |
| [ ] Chưa làm | **1** |
| [!] Sai so với GDD | **1** |
| **Tổng** (gồm 11 mã mới audit bổ sung) | **146** |

Cách kiểm: đọc từng file `src/` (core, sim, data, ui, render), đối chiếu từng con số với PDF; chạy thử headless:
- `node --test tests/*.test.mjs` → 102 test, 102 pass, 0 fail.
- `node tests/sim-harness.mjs 900 plains steel air` → kết thúc 12:03 (phá thành). `... city swarm ew` → 15:00 chưa ngã ngũ. `... bay navy air` → kết thúc 4:18 (sau 30 s triển khai ≈ 3,8 phút chiến đấu).
- Script tạm (ngoài repo): 1 tỷ USDT, 2.000 lính, 30 s triển khai đúng; chiếm cứ điểm bằng 1 tank mất **15,05 s**; trực thăng + drone đứng trong vòng 20 s **không** chiếm được; cùng seed chạy 2 lần cho trạng thái giống hệt (tất định).
- Bảng giá F-171: toàn bộ 16 dòng khớp PDF (giá + hạng). CP theo loại: tank 3, drone 1, máy bay chiến đấu 4, tàu chiến 6, tàu ngầm 5 — khớp.

## 2. Các mục chưa đạt (sắp theo mức ưu tiên)

| Mã | Mô tả | Mức độ | Bằng chứng (file:dòng) | Đề xuất sửa cụ thể |
|---|---|---|---|---|
| F-80 **[SAI]** | Tier T2 +20–25%, T3 +45–55% cho HP/sát thương/**tầm** | Trung bình | `src/data/units.js:248` `range: def.range * (1 + (m - 1) * 0.5)` → tầm chỉ +11% (T2) / +25% (T3) | Đổi thành `range: def.range * m` (hoặc hệ số ≥ 0,9 để T2 ≥ +20%, T3 ≥ +45%). Kiểm lại `retier()` ở `src/sim/economy.js:144` (dùng tỉ lệ nên tự đúng). Cập nhật chữ ở `src/ui/shop.js:148`. |
| F-178 [ ] | Thắng map có tiền trả nợ và dư tiền (tiền/nợ mang qua trận) | Trung bình | `src/sim/economy.js:311-316` tính `usdt`, `debt` nhưng không nơi nào đọc; `src/core/profile.js:164-173` khoản vay trước trận chỉ sống trong trận | Thêm `profile.usdt` + `profile.debt`: sau trận cộng `rewards.usdt`, trừ nợ còn lại; ngân sách trước trận = 1 tỷ + `profile.usdt`; hiển thị ở màn kết quả và thanh tiền tệ menu. Nếu không muốn đổi thiết kế: ít nhất hiển thị "Thưởng thắng map +500 tr USDT (trả nợ …)" ở màn kết quả. |
| F-173 [~] | Nguồn thu "thắng map (thưởng lớn)" | Trung bình | như trên, `src/sim/economy.js:40` `winReward` không được dùng | Gộp với F-178. |
| F-52 [~] | Tối đa 9 vũ khí/đơn vị quân sự (9 ô) | Trung bình | `src/core/profile.js:139-145` (1 ô tối đa 4 tank/2 máy bay); `src/sim/economy.js:325-326` mua tối đa 20 chiếc/lần vào cùng ô, không giới hạn tổng | Chốt với người dùng cách hiểu "ô". Nếu theo đúng chữ GDD: `maxCount()` = 1 (trừ bầy drone) và lệnh `buy` từ chối khi ô cùng loại đã có 1 chiếc còn sống. Nếu giữ "ô = nhóm", ghi rõ trong TUTORIAL và đặt trần tổng (vd 4/ô) cho cả mua trong trận. |
| F-16 [~] | Trận 8–12 phút | Trung bình | Harness: Vịnh biển (navy vs air) kết thúc ~3,8 phút; Thành phố > 15 phút | Tăng HP thành ở bản đồ Vịnh (`src/data/maps.js:172`, hiện 12000) hoặc giảm sát thương tàu lên công trình; thêm test cân bằng chạy 3 bản đồ × vài cặp chỉ huy, kiểm thời lượng nằm trong 6–15 phút. |
| F-85 [~] | Nâng tier tốn CP | Trung bình | `src/core/profile.js:150-153` (+1 CP/ô mỗi tier) khác `src/sim/economy.js:62` (+1 CP/chiếc chỉ ở T3) | Dùng một hàm chung (vd `unitCp(def, tier)` = cp + (tier−1)) ở cả hai nơi để CP trước trận và trong trận khớp nhau. |
| F-81 [~] | T2 mở phụ kiện, T3 phụ kiện 2 + hiệu ứng riêng | Trung bình | `src/data/units.js:224-234` chỉ là chữ; `src/ui/shop.js:143` hiển thị; hiệu ứng thật duy nhất: `src/sim/skills.js:43` (APS 2 lần) | Thêm `ACCESSORY_MODS` theo nhóm (vd drone T2 radar → +20% tầm nhìn, T3 kháng nhiễu → giảm 50% thời gian `jammed`; navy T2 VLS phụ → +2 tên lửa/loạt; aa T3 đánh chặn kép...) và áp trong `Unit` constructor/`retier`. |
| F-90 [~] | Thành phố: ngầm, nhà che tên lửa tầm xa, bất lợi tank nặng | Trung bình | `src/data/maps.js:107-125` (không có hầm); `src/sim/vision.js:245-262` không kiểm tra che khuất | Thêm kiểm tra line-of-sight qua ô `T.BUILDING` cho đơn vị mặt đất/thấp (vision + `inRange` của pháo/tên lửa không có chỉ điểm); giảm tốc tank nặng trên ô ROAD hẹp ở map city (vd `speedFactor` ×0,8 cho `size ≥ 3`); tùy chọn: vài ô "hầm" nối 2 phía cho bộ binh/UGV. |
| F-50 [~] | 5 dạng sát thương có trong game | Thấp | `src/data/units.js:208` `fire` không đơn vị nào dùng | Gán `dmgType: 'fire'` cho pháo/HIMARS loạt `barrage` (đạn nhiệt áp) hoặc thảm bom, để người chơi thấy loại "Cháy/nhiệt". |
| F-164 [~] | Chở thêm vũ khí → ít lính hơn | Thấp | `src/sim/transport.js:31-35` chỉ tính SAM/Vòm Sắt; `extraWeapons` không được set ở đâu | Thêm nút "Chở thêm vũ khí (+1 / −10 lính)" trong bảng chọn xe bọc thép/xe tải (lệnh mới `loadWeapons {unitId, n}`), và cho bộ binh thả xuống được +sát thương tương ứng. |
| F-143 [~] | Drone: thiết lập đội hình + tính năng trước | Thấp | Lệnh `formation` có ở `src/sim/ai.js:203-208` nhưng không có nút UI (grep `src/ui`, `src/match.js`) | Thêm 3 nút Hàng ngang / Mũi tên / Hàng dọc vào thanh lệnh khi đang chọn nhóm (`match.issue({type:'formation', unitIds, formation})`). |
| F-07 [~] | Điểm chỉ huy dùng gọi viện | Thấp | `src/sim/commanders.js:197` CP chỉ dùng cho lệnh tối thượng; viện binh mua bằng tiền | Thêm lệnh "Gọi viện" tốn CP (vd 30 CP → 1 tiểu đội bộ binh/2 xe ở thành chính) hoặc giảm giá mua trong trận khi trả bằng CP. |
| F-83 [~] | T2 tốn vàng + vật liệu từ trận | Thấp | `src/core/profile.js:117` T2 chỉ tốn vàng | Thêm loại "vật liệu thường" nhận sau mỗi trận, T2 tốn vàng + vài vật liệu thường. |
| F-137 [~] | Cứ điểm là điểm phòng thủ: phòng không/mìn/cảm biến | Thấp | Mìn đặt mọi nơi (`src/sim/skills.js:136-143`); không có cảm biến | Thêm "Cảm biến" mua được, chỉ đặt trong vòng cứ điểm ta giữ (mở tầm nhìn + radar bán kính 25). |
| F-27 [~] | Điểm yếu chỉ huy (Không quân phụ thuộc nhiên liệu/sân bay) | Thấp | `src/data/commanders.js:19-32`; không có nhiên liệu trong `src/sim/ai.js` | Thêm `fuel` cho máy bay (giảm khi bay, hết → buộc về sân bay như hết đạn) để điểm yếu "phụ thuộc nhiên liệu/sân bay" có thật. |
| F-123 [~] | Replay bằng chuỗi lệnh | Thấp | `src/core/game.js:83-92` commandLog + seed đủ để replay; không có màn xem lại | Thêm nút "Xem lại trận" ở màn kết quả: tạo game cùng seed/opts, phát lại `commandLog` cả 2 phe, tắt AI ra lệnh. |
| F-107 [~] | Không nhận data từ tài khoản nghi gian lận | Thấp | `src/sim/ghost.js:254-264` | Game offline, chấp nhận; có thể đánh dấu snapshot có thời lượng/điểm bất thường (vd thắng < 60 s) là nghi vấn và ẩn. |
| F-124 [~] | Server lưu snapshot | Thấp | `src/sim/ghost.js:15, 241-246` (localStorage) | Chấp nhận cho bản offline; ghi chú trong TUTORIAL. |

Ghi chú nhỏ (không đổi trạng thái):
- F-110: vài đơn vị lệch ví dụ CP (bomber 5, CCA 2, trực thăng vận tải 3, MQ-9B 2, tàu sân bay 9) — GDD chỉ ghi "ví dụ", chấp nhận.
- F-133: xe bọc thép, xe tải, pháo tự hành (nhóm `tank`) cũng chiếm được cứ điểm (`src/sim/unit.js:428`); GDD chỉ nêu tank + bộ binh. Có thể giới hạn `canCapture` cho `tank_heavy` + bộ binh nếu muốn chặt.
- F-131: chỉ đơn vị *có khả năng chiếm* của địch mới làm thanh dừng; máy bay địch bay qua mà không bắn thì không dừng (bắn trúng thì reset) — hợp lý.
- F-13: chỉ khối nhà mờ đi; đồi thấp (≤ 3 đơn vị cao) không mờ — chấp nhận.
- F-185: trên điện thoại không có nút "Hủy" lệnh đang chọn (chỉ chuột phải/Esc) — nên thêm nút ✕ khi `pendingOrder`/`pendingAbility`.

## 3. Các mục checklist cũ đã bỏ sót so với PDF (đã thêm vào checklist)

| Mã mới | Nội dung trong GDD | Trang/mục PDF | Trạng thái |
|---|---|---|---|
| F-18 | Trụ cột 4: kẻ địch mạnh dần nhờ học dữ liệu người chơi | §1 | [x] |
| F-27 | Thế mạnh/điểm yếu từng chỉ huy phản ánh vào gameplay | §3 bảng chỉ huy | [~] |
| F-53 | Tên hư cấu + lớp vũ khí thực tham chiếu | §4 | [x] |
| F-54 | UUV hoạt động tự động dài hạn, điều hướng ngầm | §4, §5 | [x] |
| F-84 | Nâng tier không đổi vai trò | §6 | [x] |
| F-85 | Nâng tier tốn điểm chỉ huy | §6 quy tắc | [~] |
| F-99 | Mỗi bản đồ đề cao nhóm đơn vị/chỉ huy (hiển thị khi chọn) | §7 | [x] |
| F-115 | Theo dõi tỉ lệ thắng, ngưỡng 45–55% | §9 cân bằng | [x] |
| F-124 | Server lưu snapshot đấu data | §10 | [~] |
| F-167 | Bộ binh có súng/giáp sẵn, không tốn tiền mua lẻ | §14 | [x] |
| F-178 | Thắng map: có tiền trả nợ và dư tiền | §15 vay nợ mục 2 | [ ] |

Đã đối chiếu và **có** trong checklist cũ (không cần thêm): % tier, CP theo loại, bảng giá 16 dòng + hạng, chiếm 15 s, 2.000 lính, 50 lính/xe, vẽ 5 lính, 1 tỷ USDT, thanh lý 50–60% (code 55%), giới hạn 1 giờ, bảng tầng nhìn thấy, vòng khắc chế, 7 lệnh MVP, 3 pha boss, luật đấu data, phím S/B, nội dung góc HUD, bảng bản đồ, hiệu ứng thời tiết.
Ngoài phạm vi theo GDD (không tính): phó tướng (chỉ "sắp ra mắt" — đã có), bản đồ mở rộng sau MVP (sa mạc, núi rừng, đảo san hô, Bắc Cực), lộ trình MVP/Unity 6 (thay bằng HTML5/Three.js theo yêu cầu người dùng), monetization thật.

## 4. Văn bản tiếng Việt cho người chơi
Có đầy đủ: cửa hàng S (`src/ui/shop.js`, 5 tab: Mua khí tài / Nâng tier / Tuyển quân / Vay vốn – Trả nợ / Bán khí tài), danh sách khí tài B (`src/ui/roster.js`: SL, Tier, HP, Đạn, Đang làm), góc HUD (`src/ui/hud.js:193-209`: binh lính tham chiến/còn lại, tiền USDT, nợ đến hạn + đếm ngược, điểm chiếm đóng 2 bên), nút 🏳 Đầu hàng có hộp xác nhận (`src/ui/hud.js:106-118`), hướng dẫn 11 bước trong trận (`src/ui/tutorial.js`) + `TUTORIAL.md` + `start.bat`.
