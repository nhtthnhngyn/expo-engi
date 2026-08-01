# Export engine — ProseMirror → Word, cho mọi phase và mọi format nghiên cứu

Dịch vụ này chuyển nội dung rich-text (ProseMirror JSON) của một phase thành file `.docx` được
định dạng đúng chuẩn, áp dụng cho bất kỳ phase nghiên cứu nào (Thiết kế đề cương, Thu thập số liệu,
Xử lý số liệu, Phân tích thống kê, Viết báo cáo, Nộp bài báo khoa học, và bất kỳ phase nào được
thêm sau này) và bất kỳ format nào trong một phase (CONSORT, STROBE, PRISMA, template của một tạp
chí cụ thể, một biểu mẫu CRF, template luận văn của một cơ sở đào tạo, v.v.).

**Trước khi động vào code của engine, hãy đọc `AGENT_BUILD_SPEC.md`.** Đây là nguồn tham chiếu
chính xác duy nhất cho các hợp đồng dữ liệu (contracts), cấu trúc thư mục, và bộ test bắt buộc.
README này chỉ là bản đồ dẫn tới tài liệu đó và một hướng dẫn khởi động nhanh, không phải bản thay
thế. Xem thêm `PROPOSAL.md` để hiểu "vì sao" ở tầm nhìn tổng quan hơn.

Có thêm hai tài liệu tập trung hơn đi kèm README này, dành cho hai nhóm người dùng chạm vào repo
này mà không cần đọc toàn bộ spec:

- **`CLAUDE_FORMAT_EXTRACTION_GUIDE.md`** — mọi thứ một trợ lý AI (Claude chat/Claude Code) cần để
  biến một tài liệu tham chiếu được tải lên thành một format entry mới: hình dạng file chính xác,
  các quy tắc bắt buộc, ví dụ minh họa. Trỏ một phiên chat vào file này khi onboard một format mới.
- **`ENGINE_INTEGRATION_GUIDE.md`** — mọi thứ một developer khác cần để gọi engine này như một
  library/service từ nền tảng nghiên cứu cộng tác: ba hàm của pipeline, bề mặt HTTP API, các mã
  lỗi, header entitlement/RBAC, và cách một editor "điền vào chỗ trống" dựa trên skeleton hoạt động.

## Nguyên tắc duy nhất quan trọng nhất

Engine hoàn toàn không phụ thuộc phase (phase-agnostic). Mọi chi tiết đặc thù theo format — style,
thứ tự section, đánh số, cấu trúc tài liệu khởi tạo, các section bắt buộc — đều nằm trong dữ liệu
dưới `/formats`, không bao giờ nằm trong code của engine.

```
ProseMirror JSON  →  Normalizer  →  Canonical Document IR  →  Renderer + Format Config  →  .docx
     (đầu vào)       (dùng chung)       (dùng chung)              (code dùng chung,
                                                                    dữ liệu riêng từng format)
```

Nếu một thay đổi cần đến `if (formatId === ...)` bên trong `/normalizer`, `/validator`, hoặc
`/renderer` — dừng lại — logic đó phải thuộc về `config.json` của một format, hoặc một block
plugin đã đăng ký, chứ không phải engine code.

## Cấu trúc repo

```
/export-engine
  /schemas                  # JSON schema: hợp đồng ProseMirror, IR, config.json, meta.json,
                             # document-skeleton.json, template-facts.json
  /core                     # TypeScript type dùng chung + kiểu lỗi có cấu trúc, helper zip/xml ooxml
  /normalizer                # ProseMirror JSON -> IR (dùng chung, không có logic riêng theo format)
    /node-mappers
    /plugins                # transform theo từng blockKind, khóa theo blockKind chứ không theo phase
  /validator                # kiểm tra IR theo requiredBlocks/hình dạng của một format
  /renderer                 # IR + format đã resolve -> bytes .docx (style, section, đánh số, TOC)
  /format-registry           # resolver (nạp config+meta+skeleton+template), style-map lint,
                             # quy trình staging/publish, bộ chạy acceptance-checklist
  /formats                  # <-- dữ liệu của mọi format nằm ở đây (xem bên dưới)
  /formats-staging          # bản nháp đang soạn qua luồng admin staging (Path B bên dưới)
  /api                      # route HTTP export + onboarding + staging/publish, RBAC, entitlement,
                             # audit log, job sync/async
  /template-extraction      # trích xuất cấu trúc theo quy tắc xác định (không dùng ML)
  /admin-ui                 # trình soạn config: viết, lint, review, publish một format đang staging
  /tools                    # script CLI: validate-schemas, build:templates, render:fixture,
                             # render:skeleton, build-registry, style-map-lint-cli
  /tests
    /fixtures                # một IR mẫu + acceptance checklist cho mỗi format, dùng cho golden test
    golden-tests.spec.ts
```

## `/formats` — nơi dữ liệu của mọi format sống

```
/formats
  _registry.json                   # index được sinh tự động của mọi format đã đăng ký (mọi status)
  /<phaseId>/
    /<formatId>/
      config.json                  # chỉ styling + mapping JSON->Word (page, typography, headings,
                                    # styleMap, toc, headingNumbering, citationStyle, pageNumbering)
      meta.json                    # cấu trúc/workflow: status, sectionOrder, requiredBlocks,
                                    # entitlement, provenance/reviewedBy
      document-skeleton.json       # tùy chọn: tài liệu ProseMirror khởi tạo mà một tài liệu mới của
                                    # format này bắt đầu từ đó (node locked và fillIn, mỗi fillIn
                                    # mang một slotId) — hậu thuẫn cho editor "điền vào chỗ trống".
                                    # Chỉ chứa nội dung chung/dùng chung — nội dung riêng tư của
                                    # người dùng nằm trong document-answers.json của riêng họ, hoàn
                                    # toàn nằm ngoài /formats (xem ENGINE_INTEGRATION_GUIDE.md và
                                    # format-registry/answers-merge.ts). examples/answers/*.json có
                                    # một ví dụ thật cho mỗi format đã có.
      template-facts.json          # tùy chọn: dữ kiện style thật theo từng style (font/cỡ chữ/đậm/...)
                                    # trích xuất từ một tài liệu tham chiếu; npm run build:templates
                                    # biến file này thành template.dotx tự động
      template.dotx                # template Word thật; style của nó phải khớp với config.json
      extraction-outline.json      # tùy chọn, tài liệu tham khảo chỉ-đọc nếu có AI hỗ trợ soạn thảo
      CHANGELOG.md
```

`config.json` và `meta.json` trả lời hai câu hỏi khác nhau và cố tình tách thành hai file riêng —
xem `formats/FORMAT_CONFIG_GUIDE.md` để biết schema đầy đủ và lý do. Một format hợp lệ chỉ cần
`config.json` + `meta.json` + `template.dotx`; `document-skeleton.json` và `template-facts.json`
là bổ sung thêm.

## Hai cách để onboard một format mới

**Path A — trích xuất có AI hỗ trợ từ một tài liệu tham chiếu được tải lên** (cách phổ biến hiện
nay — xem `CLAUDE_FORMAT_EXTRACTION_GUIDE.md` để biết quy trình đầy đủ): một trợ lý đọc OOXML thật
của một tài liệu tham chiếu `.docx` — không bao giờ đoán — và viết `config.json`,
`document-skeleton.json`, `template-facts.json`, cùng một `meta.json` tối giản (`status: "draft"`,
`reviewedBy: null`) thẳng vào `/formats/<phaseId>/<formatId>/`. Sau đó một người sẽ chạy
`npm run build:templates && npm run validate:schemas`, xem lại kết quả render
(`npm run render:skeleton -- --format=...`), rồi chuyển `status` thành `active`.

**Path B — luồng staging/admin chính thức** (`/formats-staging`, `admin-ui`,
`format-registry/publish.ts`): một người trực tiếp soạn `draft-config.json`/`draft-meta.json`
(có thể dựa theo `extraction-outline.json`), style-map lint kiểm tra mọi tham chiếu style so với
`.dotx` đã tải lên, một reviewer thứ hai test-render bản nháp so với golden fixture, và
`publishDraft` chuyển các file đã duyệt vào `/formats` và đánh dấu format là `active`. Đây là con
đường đầy đủ nghi thức hơn cho những nhóm muốn một cổng review độc lập được chính công cụ thực thi,
thay vì chỉ dựa vào quy trình làm việc.

Cả hai con đường đều hội tụ về cùng một hình dạng `/formats/<phaseId>/<formatId>/` — không có
thành phần nào phía sau (resolver, normalizer, validator, renderer, export API) quan tâm một format
đến từ con đường nào.

## Onboard format — chỉ xác định, không có quyết định của AI

Đây là một ràng buộc có chủ đích, không phải thiếu sót: không có model sinh nào quyết định *cấu
trúc của một format là gì*. Một trợ lý có thể đọc và báo cáo các dữ kiện thật từ một tài liệu tham
chiếu (tên style, font, cỡ chữ, margin, thứ tự heading) — nguyên văn, không bao giờ bịa ra — nhưng
mọi phán đoán mang tính ngữ nghĩa (heading này là chuẩn hay đặc thù theo chủ đề? style này map vào
đâu?) đều hoặc là một quy tắc cố định được áp dụng nhất quán (xem phần tách locked/fillIn trong
`CLAUDE_FORMAT_EXTRACTION_GUIDE.md`), hoặc là quyết định của con người. Một format vừa được trích
xuất luôn có `status: "draft"` và cần một người review trước khi hiển thị cho người dùng thật.

## Khởi động nhanh

```bash
# cài dependency
npm install

# kiểm tra mọi schema, config, skeleton, và template-facts theo đúng schema của chúng
npm run validate:schemas

# build template.dotx cho mọi format (từ template-definitions.ts và từ mọi template-facts.json)
npm run build:templates

# chạy toàn bộ unit test + golden test suite (xem AGENT_BUILD_SPEC.md mục 9 để biết phạm vi)
npm test

# render golden fixture của một format tại máy local
npm run render:fixture -- --format=report-writing.default

# render tài liệu khởi tạo của một format (document-skeleton.json) để xem một tài liệu mới trông thế nào
npm run render:skeleton -- --format=protocol-design.default

# gộp một document-answers.json riêng tư vào skeleton dùng chung và render tài liệu hoàn chỉnh
npm run render:answers -- --format=idea-proposal.default
```

## Kỳ vọng về testing

Mỗi thành phần đi kèm unit test ngay khi được viết, không phải viết sau — xem `AGENT_BUILD_SPEC.md`
mục 9 để biết danh sách test chính xác theo từng thành phần (normalizer, block plugin, validator,
format resolver, renderer, export API, công cụ extraction, style-map lint). Một format chưa được
coi là hoàn thành cho đến khi có golden fixture + acceptance checklist dưới `/tests/fixtures` và
vượt qua test tính xác định (determinism) (cùng một input chạy hai lần → `.docx` giống hệt nhau ở
mức byte).

## Trước khi mở PR

- Hành vi đặc thù theo format mới → đưa vào `/formats/<phaseId>/<formatId>/config.json`/`meta.json`
  hoặc một block plugin đã đăng ký, không bao giờ là một điều kiện (conditional) trong engine code
  dùng chung.
- Động vào normalizer, validator, hoặc renderer → chạy toàn bộ golden-test suite, không chỉ unit
  test của riêng thành phần đó, vì một regression ở đây ảnh hưởng đến mọi format cùng lúc.
- Thêm một format → xác nhận `npm run validate:schemas` pass (style-map lint + kiểm tra schema) và
  đã có một reviewer thứ hai ký duyệt (hoặc review gate của `publishDraft` đã thông qua) trước khi
  chuyển sang `active`.

## Đọc thêm

- `AGENT_BUILD_SPEC.md` — hợp đồng đầy đủ, schema, kế hoạch theo milestone, kế hoạch unit test,
  các rào chắn (guardrails).
- `PROPOSAL.md` — động lực, phạm vi, rủi ro, và kế hoạch triển khai nhìn tổng quan.
- `CLAUDE_FORMAT_EXTRACTION_GUIDE.md` — cách biến một tài liệu tham chiếu thành một format mới.
- `ENGINE_INTEGRATION_GUIDE.md` — cách gọi engine này từ nền tảng.
- `formats/FORMAT_CONFIG_GUIDE.md` — tham chiếu schema đầy đủ của `config.json`/`meta.json`/
  `document-skeleton.json`/`template-facts.json`, kèm ví dụ minh họa.
