# Đề xuất: Universal Research-Document Export Engine

## Vấn đề

Quy trình nghiên cứu của nền tảng hiện có sáu phase — Thiết kế đề cương, Thu thập số liệu, Xử lý số
liệu, Phân tích thống kê, Viết báo cáo, Nộp bài báo khoa học — và sẽ có thêm phase khi sản phẩm phát
triển. Nội dung của mọi phase được soạn dưới dạng rich text (ProseMirror JSON) trong editor, và
cuối cùng mọi phase đều cần rời khỏi nền tảng dưới dạng một tài liệu Word được định dạng đúng chuẩn:
một bản nháp đề cương, một CRF, một báo cáo thống kê, một bản thảo tuân thủ CONSORT/STROBE/PRISMA,
định dạng nộp bài của một tạp chí cụ thể.

Nếu xây export theo kiểu "một hàm cho mỗi phase" thì mỗi format tương lai — và mỗi phong cách trình
bày riêng của từng nền tảng nghiên cứu — sẽ thêm một codepath mới, phải bảo trì riêng biệt. Một lần
sửa lỗi hay một loại nội dung mới (một bảng, một công thức, một checklist) khi đó phải sửa N lần
thay vì một lần, và chi phí hỗ trợ thêm một format mới sẽ tăng không giới hạn.

## Giải pháp đề xuất

Xây dựng **một** export engine duy nhất, dùng chung cho mọi phase và mọi format, cộng với một
**format registry** — một thư mục chứa các file cấu hình nhỏ và template Word, mỗi format một bộ —
mà engine đọc vào lúc export. Bản thân engine không bao giờ chứa logic đặc thù cho bất kỳ phase hay
format nào; tất cả những gì đó nằm trong dữ liệu.

Cụ thể: ProseMirror JSON → một normalizer dùng chung → một biểu diễn trung gian (IR) dùng chung,
không phụ thuộc phase → một renderer Word dùng chung, tham chiếu config của một format để lấy
styling, thứ tự section, và cách đánh số. Thêm format thứ 50 vào năm sau chỉ đơn giản là thêm một
thư mục dưới `/formats` — không đụng vào code của engine.

## Vì sao đây là hình dạng đúng

- **Chi phí bảo trì tăng chậm hơn tuyến tính.** Một lần sửa lỗi trong xử lý bảng, hỗ trợ footnote,
  hay sinh mục lục (TOC) chỉ cần sửa một lần và áp dụng cho mọi format hiện tại lẫn tương lai.
- **Thêm format mới rẻ và an toàn.** Một template tạp chí mới hay định dạng đầu ra của một phase mới
  chỉ là một file config + một `.dotx`, được review và test như bất kỳ thay đổi dữ liệu nào khác —
  không cần redeploy engine, không cần review lại logic dùng chung.
- **Kiến trúc được chứng minh sớm.** Kế hoạch triển khai yêu cầu phải chạy được hai format không
  liên quan tới nhau (ví dụ một template đề cương và CONSORT) qua cùng một renderer binary trước khi
  xây thêm bất kỳ công cụ nào khác — điều này được kiểm chứng, không phải giả định.
- **Không có quyết định của AI trong luồng soạn format.** Vì các format này được dùng trong bối cảnh
  nghiên cứu và xuất bản thật (tuân thủ CONSORT/STROBE/PRISMA có hệ quả thật ở phía sau), các phán
  đoán mang tính ngữ nghĩa trong onboard format được cố tình thiết kế hoàn toàn xác định (deterministic):
  hoặc là một quy tắc cố định (heading này là chuẩn hay đặc thù theo chủ đề?), hoặc là quyết định của
  con người, không bao giờ là phỏng đoán của model. Một trợ lý có thể trích xuất các dữ kiện thật từ
  một tài liệu tham chiếu chính thức — tên style, font, cỡ chữ, margin, thứ tự heading, thậm chí cả
  một tài liệu khởi tạo "điền vào chỗ trống" — nhưng chỉ những dữ kiện thật sự có trong file, không
  bao giờ bịa ra, và mọi format vừa trích xuất đều bắt đầu ở trạng thái `draft` cho đến khi có người
  review và publish.

## Phạm vi

**Trong phạm vi (v1):** pipeline normalizer/IR/renderer; format registry và cấu trúc thư mục của nó;
export API (đồng bộ + bất đồng bộ); kiểm soát entitlement và RBAC; ghi audit log; quy trình onboard
format (soạn thủ công, có thể được hỗ trợ bởi trích xuất cấu trúc xác định); một admin UI để soạn và
publish config của format.

**Cố tình chưa làm:** round-trip tracked-changes/comment qua export; Word field cập nhật trực tiếp
(live-updating); tích hợp đầy đủ với trình quản lý trích dẫn/thư mục tài liệu tham khảo. Những mục
này được nêu rõ để phạm vi luôn trung thực — có thể làm sau khi engine lõi đã được chứng minh.

## Kế hoạch triển khai (xem `AGENT_BUILD_SPEC.md` để biết chi tiết đầy đủ)

Công việc tiến hành theo thứ tự phụ thuộc: hợp đồng dữ liệu/schema → normalizer → validator →
renderer + format đầu tiên → **format thứ hai và thứ ba để chứng minh tính tổng quát mà không cần
sửa renderer** → export API → block plugin cho nội dung phức tạp → admin config editor → hoàn thiện
(versioning, tính xác định, RBAC, audit). Mốc kiểm chứng tính tổng quát được đặt có chủ đích trước
milestone công cụ admin, để công cụ không được xây quanh một abstraction chưa được chứng minh.

## Tiêu chí thành công

- Hai format khác nhau về cấu trúc render đúng qua cùng một renderer binary, không có khác biệt nào
  trong code renderer giữa chúng.
- Một format mới có thể đi từ "có tài liệu tham chiếu chính thức trong tay" đến "format đã publish,
  đã test" mà không cần bất kỳ thay đổi code engine nào.
- Export lại cùng một nội dung với một format không đổi cho ra kết quả giống hệt nhau ở mức byte
  (tính xác định), mọi lần.
- Mọi lượt export đều có thể truy vết: ai, khi nào, phiên bản format nào, phiên bản nội dung nào.

## Rủi ro & biện pháp giảm thiểu

| Rủi ro | Biện pháp giảm thiểu |
|---|---|
| Các phase tự bịa ra kiểu node ProseMirror riêng thay vì dùng quy ước `researchBlock` dùng chung, phá vỡ tính tổng quát | Bắt buộc quy ước này ở tầng editor và từ chối input không tuân thủ ngay tại ranh giới của normalizer với một lỗi rõ ràng |
| Tên style trong `.dotx` của một format bị lệch so với những gì config của nó tham chiếu, gây sai style một cách âm thầm | Style-map lint tự động chặn publish bất kỳ config nào có style không tồn tại trong template |
| Việc soạn config dần dần tích tụ logic/điều kiện theo thời gian | Quy tắc review code: bất kỳ config nào cần một `if` sẽ được chuyển hướng sang một block plugin thay vì viết trực tiếp |
| Onboard một format mới chậm nếu không có tự động hóa | Trích xuất xác định (deterministic) tạo ra một bản nháp hoàn chỉnh — config, tài liệu khởi tạo, và các dữ kiện style thật cần thiết để tự động build template Word — mà không đóng vai trò ra quyết định nào; vẫn cần một người review trước khi đưa vào sử dụng thật |

## Đề nghị

Phê duyệt kiến trúc và thứ tự triển khai trong `AGENT_BUILD_SPEC.md`, và ưu tiên mốc kiểm chứng
tính tổng quát (hai format, một renderer) làm milestone go/no-go trước khi đầu tư thêm vào công cụ.
