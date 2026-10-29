# 2026-10-29 数据关联修复

## 行为变化

- 商品分类使用类别管理中的同一类别 ID；创建、编辑时选择类别，清空分类或描述可以正确保存。
- 同类商品订单默认带出类别；混合或未分类商品由审核人员确认。已确定的历史订单不会随商品改分类被批量改写。
- 类别管理移除追踪链接输入及请求字段。实际链接继续由出站策略中的店铺设置和承运商规则决定；数据库旧字段保留，不参与此次规则计算。
- 手工建单先选择关联仓库的发货地区，选品过滤该仓归档变体及全局归档商品；库存为零仍可选择并标明缺货。未引入新的仓库经营范围模型。
- 建单改选商品时同步自动填入的名称。审核编辑商品保存变体 ID、正确的内容版本，并清除已不匹配的平台商品关联。
- 一键映射同步补齐未扣库存、仍在审核或打包阶段的未关联订单行；映射结果及相关页面缓存同步刷新。
- 导入订单通过变体所属主商品查找内容版本，修正原先将变体 ID 用作主商品 ID 的查询。
- 发货地区必须关联仓库。打包、扣库存、创建发货记录及对应历史在同一事务内完成；失败全部回滚，重复打包不会再次扣减。
- 打包前检查所有商品、赠品的关联和当前仓库归档状态；缺货禁止打包。赠品编辑与打包通过订单更新锁协调。
- 已扣库存订单禁止直接改仓；使用中的发货地区不能更换所属仓库。退回库存及其标记在同一事务内处理，避免重复退回。
- 订单归属保存失败会显示错误并保留编辑表单；停用的类别和地区不再作为新分配选项。

## 数据库 migration

按顺序部署以下两个新增文件：

1. `apps/api/prisma/migrations/20261029160000_link_item_categories/migration.sql`
   - 为商品添加类别外键，按原分类名称关联或补建类别，保留原有名称。
   - 补齐名称明确为中国、中国仓、加拿大、加拿大仓且仓库为空的发货地区；其他自定义地区在界面中人工配置。
2. `apps/api/prisma/migrations/20261029161000_repair_pending_order_product_links/migration.sql`
   - 修复未扣库存、处于审核或打包阶段订单中的缺失商品关联、内容版本和可明确推导的类别。
   - 不覆盖已有商品关联，不按商品名称猜测，不修改已完成订单历史。

在部署环境使用项目现有命令执行所有尚未应用的 migration：

```bash
pnpm --filter @om/api db:deploy
pnpm --filter @om/api prisma:generate
```

应用代码与 migration 应配套部署。此前审核编辑商品未保存的用户选择无法从名称可靠恢复；这类名称与关联矛盾的旧订单需要在修复后的审核表单中核对。

## 验证范围

- 前后端 TypeScript 检查、前端生产构建。
- 前后端现有测试及商品改选、审核保存、映射回填、内容版本、分类清空、仓库归档、缺货、打包回滚和库存重复退回的回归测试。
- 在隔离的 PostgreSQL 兼容数据库执行全部 41 个 migration；验证分类复用、空值、外键、待处理订单修复，以及已完成订单不被改写。
- 本次没有连接或修改生产数据库。云环境不能下载 Prisma 原生引擎，使用随 Prisma 提供的 WASM 解析及无原生引擎客户端完成本地类型检查；完整的真实 PostgreSQL 端到端测试未运行。

## 修改文件

- `apps/api/prisma/migrations/20261029160000_link_item_categories/migration.sql`
- `apps/api/prisma/migrations/20261029161000_repair_pending_order_product_links/migration.sql`
- `apps/api/test/order-flow.e2e.spec.ts`
- `apps/api/src/orders/data-linkage.spec.ts`
- `apps/api/src/orders/order-product-links.ts`
- `apps/web/src/routes/items/category-select.tsx`
- `apps/web/src/routes/orders/order-entry.spec.tsx`
- `apps/api/openapi.json`
- `apps/api/prisma/schema.prisma`
- `apps/api/src/audit/audit.service.ts`
- `apps/api/src/categories/categories.controller.ts`
- `apps/api/src/inventory/inventory.service.ts`
- `apps/api/src/items/dto/item.dto.ts`
- `apps/api/src/items/item-variants.controller.ts`
- `apps/api/src/items/items.service.ts`
- `apps/api/src/mapping/mapping.service.ts`
- `apps/api/src/orders/dto/order.dto.ts`
- `apps/api/src/orders/orders.controller.ts`
- `apps/api/src/orders/orders.service.ts`
- `apps/api/src/orders/workflow-images.spec.ts`
- `apps/api/src/review/review.service.ts`
- `apps/api/src/shipping/shipment.service.ts`
- `apps/api/src/shipping/shipping-regions.controller.ts`
- `apps/api/src/shipping/shipping-work.service.ts`
- `apps/api/src/sync/sync.service.ts`
- `apps/web/src/api-client/schema.d.ts`
- `apps/web/src/i18n/locales/en.ts`
- `apps/web/src/i18n/locales/zh.ts`
- `apps/web/src/routes/items/item-detail-page.tsx`
- `apps/web/src/routes/items/items-page.tsx`
- `apps/web/src/routes/mapping/mapping-page.tsx`
- `apps/web/src/routes/orders/order-detail-page.tsx`
- `apps/web/src/routes/orders/orders-page.tsx`
- `apps/web/src/routes/review/new-order-card.tsx`
- `apps/web/src/routes/review/review-page.tsx`
- `apps/web/src/routes/settings/categories-page.tsx`
- `apps/web/src/routes/settings/shipping-regions-page.tsx`
- `apps/web/src/routes/shipping-work/shipping-work-page.tsx`
- `apps/web/src/types/item.ts`
- `docs/changes/2026-10-29-data-linkage.md`
