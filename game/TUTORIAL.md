# WARGRID: Chỉ Huy AI — Hướng dẫn bắt đầu chơi

Bạn là **chỉ huy**: không điều khiển từng chiếc xe, mà chọn nhóm → chọn lệnh → chọn điểm trên bản đồ. AI của đơn vị tự tìm đường, chọn mục tiêu, phối hợp.

---

## 1. Mở game (chỉ làm 1 lần mỗi lần chơi)

1. Cần cài **Node.js** (https://nodejs.org) — máy này đã có sẵn.
2. Mở thư mục `D:\HoangKiet\armywwar\game`.
3. **Nhấp đúp `start.bat`**. Một cửa sổ đen hiện ra ghi `WARGRID đang chạy tại http://localhost:5173/` và trình duyệt tự mở game.
   - Nếu trình duyệt không tự mở: gõ `http://localhost:5173` vào thanh địa chỉ.
   - Đừng tắt cửa sổ đen trong lúc chơi (tắt nó là tắt game).
4. Chờ thanh **"Đang tải mô hình 3D..."** chạy hết (khoảng 5–10 giây lần đầu).

> Muốn vào thẳng trận tập có hướng dẫn: mở `http://localhost:5173/?tutorial`

---

## 2. Lần đầu: bấm "Hướng dẫn chơi" (khuyên dùng)

Ở **menu chính** (bên trái màn hình), bấm nút **🎓 Hướng dẫn chơi** — nút này đang nhấp nháy viền vàng.
Game sẽ vào một trận tập (bản đồ Đồng bằng, Đại tướng Thép, địch yếu) và **tự khoét sáng đúng chỗ bạn cần click** kèm mũi tên + lời dặn. Làm đúng thao tác thì tự sang bước tiếp; nút **Tiếp** / **Bỏ qua** ở khung lời dặn.

Các bước trận tập:

| Bước | Click vào đâu | Để làm gì |
|---|---|---|
| 1 | Ô đơn vị **đầu tiên** ở thanh dưới cùng (giữa màn hình) | Chọn đơn vị để triển khai |
| 2 | **Vùng khung xanh** trên bản đồ (gần căn cứ bên trái) | Đặt đơn vị xuống |
| 3 | Nút vàng **"Sẵn sàng ▶"** (cuối thanh dưới) | Bắt đầu trận (các đơn vị chưa đặt sẽ tự triển khai) |
| 4 | **Một chiếc xe tăng** của bạn (vòng xanh dưới chân) | Chọn cả nhóm xe tăng |
| 5 | Nút **⚑ Chiếm cứ điểm** ở thanh lệnh dưới cùng | Chọn lệnh |
| 6 | **Cứ điểm** gần nhất (vòng tròn + cột cờ) | Ra lệnh chiếm |
| 7 | (Xem) thanh vàng 15 giây trên cứ điểm | Đứng đủ 15 giây không bị địch phá là cứ điểm đổi màu xanh |
| 8 | Nút **Cửa hàng (S)** và **Khí tài (B)** bên phải | Mua thêm / xem quân |
| 9 | **Bản đồ nhỏ** góc dưới trái + cách điều khiển camera | Di chuyển nhanh |
| 10 | Thẻ chỉ huy bên trái → nút **lệnh tối thượng** | Đòn đặc biệt của chỉ huy + điều kiện thắng |

---

## 3. Tự chơi một trận: "▶ Chơi nhanh"

Menu chính → **▶ Chơi nhanh**, rồi 3 bước:

1. **Chọn chỉ huy** — click 1 trong 5 thẻ (Thép / Không quân / Hải quân / Drone / Tác chiến điện tử) → **Tiếp: Xếp đội hình ▶** (góc dưới phải).
2. **Xếp đội hình** — **9 ô = 9 khí tài** (1 bầy drone tính 1 ô), **30 điểm CP**, ngân sách **1 tỷ USDT** (+ tiền dư / trừ nợ từ trận trước):
   - Bấm **★ Đề xuất** để game xếp sẵn đội hình hợp với chỉ huy (dễ nhất).
   - Hoặc click đơn vị ở **Kho đơn vị** (cột phải) để thêm vào ô trống; **T1/T2/T3** đổi tier (T3 cần vật liệu hiếm từ boss, tối đa 3 ô T3); **✕** xóa ô.
   - Khí tài quá đắt (tàu khu trục, tàu ngầm...) → chọn **Vay trước trận** (0,5 / 1 / 2 tỷ, lãi 12%, đến hạn ~8 phút) — nhớ chiếm cứ điểm để có tiền trả nợ! Hoặc mua sau trong trận bằng tiền thu từ cứ điểm (phím **S**).
   - Bấm **Tiếp: Chọn bản đồ ▶**.
3. **Chọn bản đồ** — Đồng bằng (tank/máy bay mạnh), Thành phố (drone/EW/trực thăng mạnh, có mưa), Vịnh biển (tàu chiến/tàu ngầm mạnh, có sương mù) → bấm **▶ Bắt đầu trận** (góc dưới).

### Trong trận

**a) 30 giây triển khai** (đồng hồ "TRIỂN KHAI" ở giữa trên):
click ô đơn vị ở thanh dưới → click vào **khung xanh** trên bản đồ. Lười thì bấm **Tự động triển khai**. Xong bấm **Sẵn sàng ▶**.

**b) Ra lệnh** — luôn theo thứ tự **Chọn nhóm → Chọn lệnh → Click bản đồ**:

| Thao tác | Cách làm |
|---|---|
| Chọn nhóm | Click vào 1 đơn vị (chọn cả nhóm), kéo chuột trái để khoanh vùng, hoặc phím **1–9** |
| Ra lệnh nhanh | **Chuột phải** lên bản đồ = Tấn công điểm; lên cứ điểm = Chiếm; lên địch = Ép gặp |
| Lệnh khác | Bấm nút ở **thanh lệnh dưới cùng** rồi click bản đồ |
| Hủy | **Esc**, chuột phải, hoặc nút đỏ **✕ Hủy** (hiện ra khi đang chờ chọn điểm) |
| Đội hình di chuyển | Nút **Hàng ngang / Mũi chêm / Hàng dọc** trong thẻ chỉ huy bên trái khi đang chọn nhóm |

9 lệnh: **Tấn công điểm · Phòng thủ vùng · Áp chế · Vòng đánh họng · SEAD · Rút lui/Tái lập · Ép gặp/Phá tung · Di chuyển · Chiếm cứ điểm**. Icon trên đầu mỗi đơn vị cho biết nó đang làm gì.

**c) Camera**: lăn chuột = zoom 3 mức (hoặc **Z / X**), **Q / E** xoay 4 hướng, kéo chuột phải/giữa hoặc **phím mũi tên** để di chuyển, click **bản đồ nhỏ** để nhảy tới.

**d) Phím tắt**

| Phím | Chức năng |
|---|---|
| **S** | Cửa hàng: mua khí tài, nâng tier, tuyển quân/tổng động viên, vay/trả nợ, bán khí tài |
| **B** | Danh sách khí tài: số lượng, tier, HP, đạn, đang làm gì (click dòng để chọn nhóm) |
| **R** | Lệnh tối thượng của chỉ huy (tốn điểm chỉ huy) → click bản đồ |
| **T** | Tên lửa siêu thanh (tốn tiền, hồi 150 giây) → click bản đồ → xác nhận |
| **V** | Gọi viện (40 điểm chỉ huy): 2 tiểu đội bộ binh + 1 xe bọc thép xuất hiện ở căn cứ |
| **1–9** | Chọn nhóm theo ô đội hình |
| **Space** | Đưa camera tới nhóm đang chọn |
| **P** / **Esc** | Tạm dừng: Tiếp tục · Chất lượng đồ họa (Cao/Thấp) · **Thoát ra menu** (không tính thua) · Đầu hàng |

Trên điện thoại: chạm để chọn/đặt, kéo 1 ngón để di chuyển camera, chụm 2 ngón để zoom; các nút S/B/xoay/zoom ở cạnh phải màn hình.

**e) Đọc góc màn hình**: trên trái = binh lính tham chiến/còn lại, tiền USDT, nợ đến hạn (đếm ngược), điểm chỉ huy; trên phải = điểm chiếm đóng hai bên, số cứ điểm.

### Thắng / thua
- **Thắng**: phá **thành chỉ huy** (tòa nhà lớn ở căn cứ địch, bên phải bản đồ), hoặc địch đầu hàng, hoặc hết 1 giờ mà điểm chiếm đóng cao hơn.
- **Thua**: thành chỉ huy của bạn bị phá, bấm **Đầu hàng**, hết binh lính, hoặc hết tiền không trả được nợ.

**Mẹo**: chiếm nhiều **cứ điểm** sớm (bộ binh/xe tăng, máy bay không chiếm được) → có tiền, điểm chỉ huy, hồi máu và tầm nhìn. Xe bọc thép/trực thăng vận tải tự chở lính từ căn cứ ra.

---

## 4. Các chế độ khác
- **Chiến dịch Boss**: 4 ải (tàu sân bay, thành đài phòng không, tàu ngầm chiến lược, thành phố AI), mỗi boss 3 pha. Thắng nhận vàng + vật liệu hiếm (dùng nâng T3).
- **Đấu data**: mở khóa sau khi hạ cả 4 boss — đấu với đội hình + chuỗi lệnh đã lưu của người chơi khác.
- **Hồ sơ & Nhiệm vụ**: nhiệm vụ ngày, skin (chỉ đổi màu, không tăng sức mạnh), thống kê tỉ lệ thắng.
