# WARGRID: Chỉ Huy AI — Checklist tính năng theo GDD

Mỗi dòng có mã `F-xx`. Agent kiểm tra đối chiếu từng mã với code; agent test dùng mã này trong báo cáo.
Trạng thái: `[ ]` chưa làm · `[~]` làm đơn giản hóa (ghi rõ) · `[x]` xong · `[!]` SAI so với GDD.
Lần rà soát gần nhất: 2026-10-23 (GDD compliance audit, xem `docs/GDD_AUDIT.md`). Các mã thêm mới do audit bổ sung từ PDF được đánh dấu *(audit)*.

## 1. Tổng quan & core loop (GDD §1–2)
- [x] F-01 Tên game "WARGRID: Chỉ Huy AI" trên màn hình chính
- [x] F-02 Người chơi không điều khiển từng đơn vị: chọn nhóm + ra lệnh, AI tự thực thi
- [x] F-03 Core loop: Chuẩn bị → Triển khai (30 giây) → Ra lệnh → AI thực thi → đọc chiến trường → ra lệnh tiếp
- [x] F-04 Chuẩn bị ngoài trận: chọn 1/5 chỉ huy, xếp đội hình tối đa 9 ô, nâng tier
- [x] F-05 Triển khai 30 giây đầu: đặt đơn vị trong vùng triển khai được phép (có đồng hồ đếm ngược)
- [x] F-06 Ra lệnh: chạm/click chọn nhóm → chọn lệnh → chọn điểm trên bản đồ
- [x] F-07 Điểm chỉ huy (năng lực chỉ huy) hồi khi chiếm điểm tài nguyên, dùng gọi viện / lệnh tối thượng
  - "Gọi viện" (lệnh `reinforce`, nút + phím V): 40 CP → 2 tiểu đội bộ binh + 1 xe bọc thép ở thành chỉ huy, hồi 90 giây; quân hỗ trợ không chiếm ô đội hình. CP còn dùng cho lệnh tối thượng (sim/commanders.js REINFORCE).
- [x] F-08 Thắng bằng phá căn cứ địch hoặc hạ boss
- [x] F-09 Camera 2.5D isometric, nghiêng 45–55°, xoay 4 hướng
- [x] F-10 Zoom 3 mức: chiến lược / chiến thuật / cận cảnh
- [x] F-11 Mô hình 3D low-poly, nhìn rõ độ cao: máy bay bay trên, tàu ngầm chìm dưới
- [x] F-12 Máy bay đổ bóng xuống mặt đất
- [x] F-13 Nhà/đồi che đơn vị thì trở nên trong suốt
- [x] F-14 4 tầng độ cao: Không (cao) / Thấp (trung) / Mặt đất-nước (0) / Dưới nước (âm)
- [x] F-15 Quy tắc nhìn thấy theo tầng: tầng cao chỉ radar/SAM thấy; tầng thấp mắt thường + phòng không tầm ngắn; mặt đất mọi đơn vị; dưới nước chỉ sonar
- [x] F-16 Phiên đấu mục tiêu 8–12 phút (cân bằng), tối đa 1 giờ
  - AI vs AI với kinh tế thật (đề xuất theo bản đồ, giữ 10% tiền): 3 bản đồ × 3 cặp × 2 seed nằm trong 8–14 phút (tests/balance.test.mjs). Đòn bẩy: giai đoạn quyết chiến từ phút 7 (sát thương lên công trình tăng +100%/phút, tối đa ×6), pháo kích chiến lược từ phút 11 (thành chính mất máu theo số cứ điểm địch giữ), AI tổng tấn công sau phút 9 (sim/victory.js SIEGE, enemyAI.js). Chỉ áp dụng Chơi nhanh / Đấu data.
- [x] F-17 Chơi được trên PC (chuột + phím) và mobile (chạm)
- [x] F-18 *(audit)* Trụ cột 4: kẻ địch mạnh dần nhờ học từ dữ liệu người chơi (profile.learned + độ khó theo rating, enemyAI tăng dần theo thời gian)

## 2. Hệ thống chỉ huy (GDD §3)
- [x] F-20 5 chỉ huy: Đại tướng Thép, Tư lệnh Không quân, Đô đốc Hải quân, Chỉ huy Drone/Swarm, Chỉ huy Tác chiến Điện tử
- [x] F-21 Mỗi chỉ huy có học thuyết, thế mạnh, điểm yếu hiển thị khi chọn
- [x] F-22 Mỗi chỉ huy có 1 kỹ năng thụ động (có hiệu lực trong trận)
- [x] F-23 Lệnh tối thượng: Miệng Chôn (tank+bộ binh xuyên tuyến) / Mưa Thép (không kích diện rộng) / Phong Tỏa (vùng tên lửa hành trình + sonar) / Đàn Ong (20–50 drone tự sát) / Màn Đêm (nhiễu radar, hack địch tạm thời)
- [x] F-24 Mỗi chỉ huy có 1 chỉ số thưởng tier
- [x] F-25 Chỉ huy khóa khi vào trận; đổi được giữa các trận
- [x] F-26 Phó tướng: KHÔNG làm (ngoài MVP) — chỉ ghi "sắp có"
- [~] F-27 *(audit)* Thế mạnh/điểm yếu trong bảng chỉ huy phản ánh vào gameplay (Thép: HP/giáp cao + phá công trình nhanh; Không quân: phụ thuộc nhiên liệu/sân bay; Hải quân: yếu trên đất liền...)
  - Có qua passive + chỉ số đơn vị; không có cơ chế nhiên liệu (máy bay chỉ hết đạn → về nạp), "yếu trên đất liền" chỉ là hệ quả đội hình.

## 3. Đơn vị & vũ khí (GDD §4) — tên hư cấu
- [x] F-30 Tank hạng nặng — kỹ năng ERA/APS chặn đạn
- [x] F-31 Xe bộ binh/pháo tự hành — bắn tầm xa, dồn đạn
- [x] F-32 UGV — rải mìn, che chắn, mồi nhử
- [x] F-33 Drone trinh sát — mở sương, chỉ điểm mục tiêu cho cả đội
- [x] F-34 Drone tự sát (loitering) — lượn chờ, lạc hướng khi bị nhiễu
- [x] F-35 Bầy drone (swarm) — tính 1 ô, tấn công nhiều hướng
- [x] F-36 Tiêm kích tàng hình — tàng hình tạm thời, tên lửa tầm xa
- [x] F-37 Trực thăng tấn công — bay sát đất, tên lửa chống tăng
- [x] F-38 Máy bay ném bom — thảm bom diện rộng
- [x] F-39 Máy bay vô nhân cộng tác (CCA) — bay theo máy bay chủ, mồi nhử, nhận đạn thay
- [x] F-40 Khu trục/tàu chống ngầm — phòng không tầm xa, VLS
- [x] F-41 Tàu tàng hình/tàu tấn công — pháo tầm xa, drone trên tàu
- [x] F-42 Tàu ngầm tấn công — ẩn mình, ngư lôi/tên lửa từ dưới nước
- [x] F-43 UUV/XLUUV — rải mìn, trinh sát ngầm
- [x] F-44 SAM/BMD — bắn hạ tên lửa, drone, máy bay
- [x] F-45 Laser/HPM — bắn chùm phá bầy drone, cần hồi năng lượng
- [x] F-46 Tên lửa siêu thanh — gọi từ chỉ huy, hồi chiêu rất dài, xuyên phòng không
- [x] F-47 EW/SIGINT — nhiễu radar, cắt liên lạc, làm lạc tên lửa/drone
- [x] F-48 Bộ binh — súng + giáp tiêu chuẩn, vận hành vũ khí, chiếm cứ điểm
- [x] F-49 Trực thăng vận tải & xe bọc thép chở quân, xe tải chở phòng không
- [x] F-50 5 dạng sát thương: xuyên giáp, nổ (HE), cháy/nhiệt, điện tử (EMP), năng lượng (laser)
  - Đủ 5 loại; "Cháy/nhiệt" dùng cho kỹ năng Dồn đạn của pháo tự hành Bão Lửa (đạn nhiệt áp) + cháy lan 4 giây cho đơn vị mặt đất trong vùng nổ (combat.js BURN).
- [x] F-51 Vòng khắc chế: Laser>Drone>Tank>Bộ binh/Pháo; SAM>Máy bay>Tank/Tàu; EW>mọi đơn vị điều khiển từ xa
- [x] F-52 Giới hạn 9 ô đội hình (bầy drone = 1 ô)
  - 1 ô = 1 khí tài (bầy drone = 1 ô): trước trận mỗi ô đúng 1 đơn vị (bỏ nút +/−), mua trong trận chiếm ô trống/ô có khí tài đã mất, từ chối khi đủ 9 khí tài còn sống. Lính do xe chở thả xuống và đơn vị tạm thời từ kỹ năng không tính. Dữ liệu cũ {count: n} được tách thành n ô (data/units.js expandFormation).
- [x] F-53 *(audit)* Đơn vị đặt tên hư cấu + hiển thị lớp vũ khí thực tham chiếu (ref) trong cửa hàng/đội hình
- [x] F-54 *(audit)* UUV "hoạt động tự động dài hạn" + điều hướng ngầm (tự tuần tra, tự né vùng nguy hiểm)

## 4. AI chiến thuật (GDD §5)
- [x] F-60 3 tầng AI: chiến lược (người chơi) / chiến thuật nhóm (chia vai, chọn đường) / đơn vị (chọn mục tiêu, né, kỹ năng tự động)
- [x] F-61 Lệnh Tấn công điểm
- [x] F-62 Lệnh Phòng thủ vùng
- [x] F-63 Lệnh Áp chế (bắn giữ chân, không tiến)
- [x] F-64 Lệnh Vòng đánh họng (flank, đi vòng đánh sau)
- [x] F-65 Lệnh SEAD (ưu tiên diệt phòng không)
- [x] F-66 Lệnh Rút lui/Tái lập (về căn cứ sửa chữa, tự động khi HP<30%)
- [x] F-67 Lệnh Ép gặp/Phá tung (tất cả dồn một mục tiêu)
- [x] F-68 Behavior tree mỗi loại + Utility AI chọn mục tiêu + Influence map + Formation
- [x] F-69 Icon ý định trên đầu mỗi đơn vị
- [x] F-70 Human-in-the-loop: đòn lớn (siêu thanh, bom) chỉ người chơi kích hoạt
- [x] F-71 Tự nhận diện mục tiêu, APS né đạn, điều phối bầy drone, CCA bay theo chủ, laser tự ngắm

## 5. Tier (GDD §6)
- [x] F-80 3 tier: T1 100%, T2 +20–25%, T3 +45–55% (HP, giáp, sát thương, tầm, tốc độ, hồi chiêu)
  - HP/sát thương/tầm ×1.22 (T2, +22%) và ×1.5 (T3, +50%); giáp +11%/+25%, tốc độ +7%/+15%, hồi chiêu nhanh hơn 18%/33% — chữ trong cửa hàng/xếp đội hình lấy từ tierBonusText() nên luôn khớp số thật.
- [x] F-81 T2 mở 1 phụ kiện, T3 phụ kiện thứ 2 + hiệu ứng riêng (VD tank T3 APS chặn 2 lần)
  - Mỗi nhóm 2 phụ kiện có hiệu ứng thật (data/units.js ACCESSORY_FX): tank APS hồi nhanh 30% / chặn 2 lần; drone +25% tầm nhìn / kháng nhiễu; máy bay +2 đạn / +10% tầm; tàu VLS +50% / +20% đánh chặn; tàu ngầm ngư lôi +20% / sonar địch −30%; phòng không +15% tầm / đánh chặn kép; laser +50% năng lượng / +1 drone mỗi phát; EW +20% bán kính / hack +4 giây; bộ binh +15% giáp / không bị mưa giảm tầm nhìn. Áp khi spawn và khi nâng tier trong trận; hiện ở tab Nâng tier, danh sách B và xếp đội hình.
- [x] F-82 Giới hạn tối đa 3 đơn vị T3 trong đội hình
- [~] F-83 Nâng tier tốn tiền/vật liệu (T3 cần vật liệu hiếm từ boss)
  - T3 cần vật liệu hiếm đúng; T2 ngoài trận chỉ tốn vàng (GDD: "Vàng + vật liệu từ trận").
- [x] F-84 *(audit)* Nâng tier chỉ tăng chỉ số + phụ kiện nhỏ, không đổi vai trò
- [x] F-85 *(audit)* Nâng tier tốn điểm chỉ huy (CP) để không dồn toàn T3
  - Một công thức unitCp(def, tier) = CP gốc + (tier − 1) dùng chung cho xếp đội hình (profile.slotCp) và trong trận (economy: mua, nâng mọi bậc tier đều kiểm CP).

## 6. Bản đồ (GDD §7)
- [x] F-90 Bản đồ Thành phố: nhà cao, phố hẹp, cầu — lợi UGV/FPV/trực thăng/EW, bất lợi tank nặng/hải quân
  - Nhà chặn tầm nhìn mặt đất (≥ 2 ô nhà trên đường ngắm; máy bay/radar nhìn qua), pháo/HIMARS không có chỉ điểm không bắn được mục tiêu sau nhà, xe nặng (size ≥ 3) chậm 25% ngoài đường, 2 cặp hầm ngầm dưới kênh cho bộ binh/UGV (sim/tunnels.js, trễ 4 giây, vẽ cửa hầm ở world.js).
- [x] F-91 Bản đồ Đồng bằng: rộng, đồi, sông nhỏ — lợi tank/pháo/máy bay
- [x] F-92 Bản đồ Vịnh biển: đảo, eo biển, vùng cạn/sâu — lợi tàu/tàu ngầm/máy bay, tank chỉ trên đảo
- [x] F-93 Mỗi bản đồ: 3 lane + vùng giữa + căn cứ 2 bên
- [x] F-94 Sương chiến trường (fog of war)
- [x] F-95 Điểm tài nguyên/cứ điểm hồi điểm chỉ huy
- [x] F-96 Sân bay/cảng hồi máy bay/tàu (nạp đạn)
- [x] F-97 Công trình phá được
- [x] F-98 Thời tiết: mưa giảm tầm nhìn, sương mù ẩn drone
- [x] F-99 *(audit)* Màn chọn bản đồ hiển thị địa hình, chiến thuật, đơn vị lợi thế / bị hạn chế, thời tiết

## 7. PvE boss & đấu data (GDD §8)
- [x] F-100 Chế độ ải boss: mỗi chương 1 boss lớn có cơ chế riêng (tàu sân bay, thành đài phòng không, tàu ngầm chiến lược, thành phố AI)
- [x] F-101 Boss 3 pha: phòng thủ → gọi viện → ép gặp
- [x] F-102 Vượt hết ải boss mở khóa Đấu data
- [x] F-103 Thắng trận lưu snapshot: đội hình + chuỗi lệnh + thời điểm ra lệnh
- [x] F-104 Chọn đối thủ trong kho data theo hạng / chỉ huy / ngẫu nhiên (có data mồi do AI tạo sẵn)
- [x] F-105 AI điều khiển đội hình data theo chuỗi lệnh đã lưu, phản ứng khi lệch kịch bản
- [x] F-106 Thắng được thưởng + hạng; người đặt data nhận uy tín
- [~] F-107 Chống lạm dụng: lọc data tỉ lệ thắng bất thường, giới hạn số lần đấu cùng một data
  - Có lọc >90% thắng (≥10 trận) và tối đa 3 lần/ngày/data. Thiếu "không nhận data khi tài khoản bị nghi gian lận" (game offline, không có tài khoản — chấp nhận).

## 8. Cân bằng, kinh tế, tiến trình (GDD §9)
- [x] F-110 Điểm chỉ huy (CP) giới hạn đội hình: tank 3, drone 1, máy bay 4, tàu chiến 6, tàu ngầm 5 (theo loại + tier)
- [x] F-111 Tiền tệ ngoài trận: Vàng (thắng trận, nhiệm vụ ngày), Vật liệu hiếm (boss, đấu data), Huy hiệu (mùa giải → skin)
- [x] F-112 Nhiệm vụ ngày
- [x] F-113 Skin/ngoại hình chỉ thẩm mỹ, không pay-to-win; battle pass (mô phỏng)
- [x] F-114 Thống kê tỉ lệ thắng từng chỉ huy/đơn vị (lưu local)
- [x] F-115 *(audit)* Ngưỡng cân bằng tỉ lệ thắng 45–55% được theo dõi/hiển thị

## 9. Kỹ thuật, art (GDD §10)
- [x] F-120 Low-poly 3D, màu theo phe, silhouette rõ
- [x] F-121 Hiệu ứng tàng hình, EW, laser, hỏa lực dễ đọc
- [x] F-122 Bầy drone số lượng lớn chạy mượt (instancing)
- [~] F-123 Replay bằng chuỗi lệnh xác định (seeded RNG)
  - Mô phỏng tất định (đã kiểm: cùng seed → cùng trạng thái) + commandLog, dùng cho Đấu data; chưa có màn "Xem lại trận" cho người chơi.
- [~] F-124 *(audit)* Lưu snapshot đội hình cho đấu data trên server
  - Lưu localStorage (offline). Engine Unity 6 trong GDD được thay bằng HTML5/Three.js theo yêu cầu người dùng.

## 10. Cứ điểm & chiếm đóng (GDD §11)
- [x] F-130 Nhiều cứ điểm trên bản đồ
- [x] F-131 Chiếm: vào vòng + cắm cờ 15 giây liên tục; địch xuất hiện → thanh dừng/reset
- [x] F-132 Sau 15 giây đổi màu sang phe chiếm
- [x] F-133 Chỉ đơn vị mặt đất chiếm được (tank, bộ binh); máy bay/drone không chiếm
- [x] F-134 Trực thăng chiếm được nếu đáp xuống thả bộ binh
- [x] F-135 Tàu ngầm: thắng dưới nước, cập bến, thả bộ binh; địch gần bến thì không đổ bộ
- [x] F-136 Phòng không đặt ở cứ điểm phải do xe tải/xe bọc thép chở tới rồi triển khai
- [~] F-137 Lợi ích cứ điểm: điểm chiếm đóng theo thời gian, thu nhập, hồi máu nhẹ trong vòng, đặt phòng không/mìn/cảm biến, mở tầm nhìn
  - Đủ điểm/thu nhập/hồi máu/tầm nhìn/đặt phòng không; mìn đặt được ở bất kỳ đâu (không gắn cứ điểm); không có "cảm biến".

## 11. Hành vi chiến đấu theo khí tài (GDD §12)
- [x] F-140 Tiêm kích tấn công theo đường bay vòng tròn / số 8 / chữ U; hết đạn bay về thành nạp đạn rồi quay lại
- [x] F-141 Trực thăng vận tải: chở bộ binh → thả → quay về chở thêm
- [x] F-142 Xe bọc thép: chở → thả → quay về; chở thêm vũ khí thì ít lính hơn
- [x] F-143 Drone: thiết lập đội hình + tính năng trước (trinh sát, chỉ điểm, tự sát, EW)
  - Nút đội hình Hàng ngang / Mũi chêm / Hàng dọc cho nhóm đang chọn (abilities.js, lệnh sim `formation`).
- [x] F-144 Phòng không không tự di chuyển khi đang triển khai
- [x] F-145 Bộ binh chỉ hồi quân khi có nguồn từ cứ điểm/thành chính
- [x] F-146 Pháo tầm xa/hack phải vào đủ tầm, cần chỉ điểm

## 12. Thắng & thua (GDD §13)
- [x] F-150 Thắng 1: phá thành chỉ huy địch
- [x] F-151 Thắng 2: địch đầu hàng
- [x] F-152 Thắng 3: hết 1 giờ → điểm chiếm đóng cao hơn thắng; hòa điểm → nhiều binh lính hơn thắng
- [x] F-153 Thua 1: thành mình bị phá
- [x] F-154 Thua 2: đầu hàng (nút Đầu hàng)
- [x] F-155 Thua 3: hết binh lính
- [x] F-156 Thua 4: hết tiền, không trả nợ đến hạn sau khi đã bán khí tài
- [x] F-157 Điểm chiếm đóng = số cứ điểm × thời gian giữ + điểm phụ phá công trình + hạ khí tài giá trị cao

## 13. Bộ binh, vận tải, quân số (GDD §14)
- [x] F-160 Mỗi bên bắt đầu 2.000 binh lính
- [x] F-161 Sức chứa tối đa mỗi xe/trực thăng 50 lính (trực thăng nhỏ ít hơn)
- [x] F-162 Mỗi xe vận tải chỉ vẽ 5 lính đại diện
- [x] F-163 Số quân thực tế hiển thị góc màn hình (đang chiến đấu / còn lại)
- [x] F-164 Chở thêm vũ khí → giảm số lính tối đa
  - Lệnh `loadWeapons` + nút "Chở thêm vũ khí" cho xe bọc thép / trực thăng vận tải: mỗi vũ khí −10 chỗ lính, tiểu đội thả xuống +30% sát thương (tối đa 2).
- [x] F-165 Tuyển quân: tốn tiền + thời gian huấn luyện, giới hạn tốc độ mỗi phút
- [x] F-166 Tổng động viên: đợt tuyển lớn, tăng chi phí duy trì/phút, giảm thu nhập
- [x] F-167 *(audit)* Bộ binh có súng + giáp tiêu chuẩn sẵn, không tốn tiền mua lẻ (chỉ tốn lính dự bị)

## 14. Kinh tế, vay nợ, mua khí tài (GDD §15)
- [x] F-170 Mỗi bên bắt đầu 1 tỷ USDT
- [x] F-171 Bảng giá tham chiếu + hạng A/S/SR/UR (FPV 500, Switchblade 150k, Javelin 250k, TB2 5tr, M1A2 10tr, HIMARS 5–6tr, K9 5tr, AH-64E 35tr, MQ-9B 30tr, F-35A 80tr, Rafale 100tr, Iron Dome 100tr, Patriot/S-400 0,5–1 tỷ, Arleigh Burke 2,2 tỷ, Virginia 3,5 tỷ, Ford 13 tỷ)
- [x] F-172 Khí tài > 1 tỷ không mua được lúc đầu: cần thu nhập hoặc vay
- [x] F-173 Nguồn thu: cứ điểm (theo phút) + thắng map (thưởng lớn) + hạ khí tài địch (thưởng nhỏ)
  - Cứ điểm theo phút + hạ khí tài (15% giá trị) + thưởng thắng map 500 tr (thua: trợ cấp 50 tr) được cộng vào hồ sơ (profile.usdt) sau trận.
- [x] F-174 Vay: có lãi suất + kỳ hạn
- [x] F-175 Đến hạn không đủ tiền → bán khí tài (50–60% giá mua)
- [x] F-176 Bán hết vẫn không đủ → thua
- [x] F-177 Nâng tier bằng tiền
- [x] F-178 *(audit)* Thắng map: có tiền trả nợ và dư tiền (tiền/nợ USDT mang qua giữa các trận)
  - profile.usdt / profile.debt: thưởng trận trả nợ mang sang + khoản vay chưa trả trước, phần dư mang sang; thua thì khoản vay chưa trả thành nợ. Ngân sách trận sau = 1 tỷ + USDT − nợ (không âm; nợ lớn hơn thì giữ phần dư). Hiện ở thanh tiền tệ menu, xếp đội hình và màn kết quả.

## 15. Giao diện & phím tắt (GDD §16)
- [x] F-180 Phím S: cửa hàng (mua khí tài, nâng tier, tuyển quân, vay vốn)
- [x] F-181 Phím B: danh sách khí tài (số lượng, tier, HP, đạn, đang làm gì)
- [x] F-182 Góc màn hình: binh lính tham chiến/còn lại, tiền USDT, nợ đến hạn, điểm chiếm đóng 2 bên
- [x] F-183 Vòng tầm bắn khi chọn đơn vị
- [x] F-184 Thanh chiếm 15 giây trên cứ điểm
- [x] F-185 Có nút trên màn hình thay cho phím (mobile)
  - Có nút "✕ Hủy" nổi khi đang chọn điểm cho lệnh/triển khai/kỹ năng (abilities.js).

## 16. Hướng dẫn (yêu cầu người dùng)
- [x] F-190 Tutorial trong game: chỉ rõ click vào đâu để bắt đầu chơi, từng bước
- [x] F-191 File TUTORIAL.md hướng dẫn chạy game và chơi
