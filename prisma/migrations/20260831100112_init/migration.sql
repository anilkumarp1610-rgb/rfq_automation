BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[users] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [email] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [passwordHash] NVARCHAR(1000) NOT NULL,
    [is_active] BIT NOT NULL CONSTRAINT [users_is_active_df] DEFAULT 1,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [users_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL,
    CONSTRAINT [users_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [users_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[roles] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [code] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [roles_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [roles_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[user_roles] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [userId] BIGINT NOT NULL,
    [roleId] BIGINT NOT NULL,
    CONSTRAINT [user_roles_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [user_roles_userId_roleId_key] UNIQUE NONCLUSTERED ([userId],[roleId])
);

-- CreateTable
CREATE TABLE [dbo].[audit_logs] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [entityType] NVARCHAR(1000) NOT NULL,
    [entityId] BIGINT NOT NULL,
    [action] NVARCHAR(1000) NOT NULL,
    [changes] NVARCHAR(1000) NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [audit_logs_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [createdBy] BIGINT,
    CONSTRAINT [audit_logs_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[product_types] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [name] NVARCHAR(1000) NOT NULL,
    [description] NVARCHAR(1000),
    [is_active] BIT NOT NULL CONSTRAINT [product_types_is_active_df] DEFAULT 1,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [product_types_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL,
    CONSTRAINT [product_types_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[material_types] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [name] NVARCHAR(1000) NOT NULL,
    [is_active] BIT NOT NULL CONSTRAINT [material_types_is_active_df] DEFAULT 1,
    CONSTRAINT [material_types_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [material_types_name_key] UNIQUE NONCLUSTERED ([name])
);

-- CreateTable
CREATE TABLE [dbo].[material_categories] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [material_type_id] BIGINT NOT NULL,
    [grade_code] NVARCHAR(1000) NOT NULL,
    [description] NVARCHAR(1000),
    [density_kg_m3] DECIMAL(32,16) NOT NULL,
    [is_active] BIT NOT NULL CONSTRAINT [material_categories_is_active_df] DEFAULT 1,
    CONSTRAINT [material_categories_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [material_categories_material_type_id_grade_code_key] UNIQUE NONCLUSTERED ([material_type_id],[grade_code])
);

-- CreateTable
CREATE TABLE [dbo].[material_shapes] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [name] NVARCHAR(1000) NOT NULL,
    [is_active] BIT NOT NULL CONSTRAINT [material_shapes_is_active_df] DEFAULT 1,
    CONSTRAINT [material_shapes_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [material_shapes_name_key] UNIQUE NONCLUSTERED ([name])
);

-- CreateTable
CREATE TABLE [dbo].[material_size_configs] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [material_category_id] BIGINT NOT NULL,
    [material_shape_id] BIGINT NOT NULL,
    [od_mm] DECIMAL(32,16),
    [id_mm] DECIMAL(32,16),
    [width_mm] DECIMAL(32,16),
    [thickness_mm] DECIMAL(32,16),
    [length_mm] DECIMAL(32,16),
    [uom] NVARCHAR(1000) NOT NULL,
    [standard_weight_per_unit] DECIMAL(32,16),
    [is_active] BIT NOT NULL CONSTRAINT [material_size_configs_is_active_df] DEFAULT 1,
    CONSTRAINT [material_size_configs_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[material_prices] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [material_size_config_id] BIGINT NOT NULL,
    [rate_per_kg] DECIMAL(32,16) NOT NULL,
    [currency] NVARCHAR(1000) NOT NULL CONSTRAINT [material_prices_currency_df] DEFAULT 'INR',
    [supplier] NVARCHAR(1000),
    [moq] DECIMAL(32,16),
    [effective_from] DATETIME2 NOT NULL,
    [effective_to] DATETIME2,
    [is_active] BIT NOT NULL CONSTRAINT [material_prices_is_active_df] DEFAULT 1,
    CONSTRAINT [material_prices_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[handling_configs] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [material_type_id] BIGINT,
    [procurement_pct] DECIMAL(32,16) NOT NULL,
    [transportation_rate] DECIMAL(32,16) NOT NULL,
    [transportation_uom] NVARCHAR(1000) NOT NULL,
    [storage_pct] DECIMAL(32,16) NOT NULL,
    [effective_from] DATETIME2 NOT NULL,
    [effective_to] DATETIME2,
    [is_active] BIT NOT NULL CONSTRAINT [handling_configs_is_active_df] DEFAULT 1,
    CONSTRAINT [handling_configs_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[processes] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [name] NVARCHAR(1000) NOT NULL,
    [process_type] NVARCHAR(1000) NOT NULL,
    [costing_method] NVARCHAR(1000) NOT NULL,
    [default_rate] DECIMAL(32,16),
    [uom] NVARCHAR(1000) NOT NULL,
    [description] NVARCHAR(1000),
    [is_active] BIT NOT NULL CONSTRAINT [processes_is_active_df] DEFAULT 1,
    CONSTRAINT [processes_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[machines] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [name] NVARCHAR(1000) NOT NULL,
    [type] NVARCHAR(1000) NOT NULL,
    [hourly_rate] DECIMAL(32,16) NOT NULL,
    [depreciation_hr] DECIMAL(32,16) NOT NULL,
    [power_hr] DECIMAL(32,16) NOT NULL,
    [maintenance_hr] DECIMAL(32,16) NOT NULL,
    [operator_hr] DECIMAL(32,16) NOT NULL,
    [tooling_hr] DECIMAL(32,16) NOT NULL,
    [overhead_hr] DECIMAL(32,16) NOT NULL,
    [is_active] BIT NOT NULL CONSTRAINT [machines_is_active_df] DEFAULT 1,
    CONSTRAINT [machines_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [machines_name_key] UNIQUE NONCLUSTERED ([name])
);

-- CreateTable
CREATE TABLE [dbo].[qc_configs] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [method] NVARCHAR(1000) NOT NULL,
    [qc_pct] DECIMAL(32,16) NOT NULL,
    [inspection_standards] NVARCHAR(1000),
    [effective_from] DATETIME2 NOT NULL,
    [effective_to] DATETIME2,
    [is_active] BIT NOT NULL CONSTRAINT [qc_configs_is_active_df] DEFAULT 1,
    CONSTRAINT [qc_configs_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[overhead_configs] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [admin_pct] DECIMAL(32,16) NOT NULL,
    [effective_from] DATETIME2 NOT NULL,
    [effective_to] DATETIME2,
    [is_active] BIT NOT NULL CONSTRAINT [overhead_configs_is_active_df] DEFAULT 1,
    CONSTRAINT [overhead_configs_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[customer_margin_maps] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [rating] INT NOT NULL,
    [base_margin_pct] DECIMAL(32,16) NOT NULL,
    [effective_from] DATETIME2 NOT NULL,
    [effective_to] DATETIME2,
    [is_active] BIT NOT NULL CONSTRAINT [customer_margin_maps_is_active_df] DEFAULT 1,
    CONSTRAINT [customer_margin_maps_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [customer_margin_maps_rating_effective_from_key] UNIQUE NONCLUSTERED ([rating],[effective_from])
);

-- CreateTable
CREATE TABLE [dbo].[customers] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [code] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [rating] INT NOT NULL CONSTRAINT [customers_rating_df] DEFAULT 3,
    [commercial_score] DECIMAL(32,16),
    [payment_terms] NVARCHAR(1000),
    [currency] NVARCHAR(1000) NOT NULL CONSTRAINT [customers_currency_df] DEFAULT 'INR',
    [gst_no] NVARCHAR(1000),
    [tax_applicable] BIT NOT NULL CONSTRAINT [customers_tax_applicable_df] DEFAULT 1,
    [delivery_location] NVARCHAR(1000),
    [address] NVARCHAR(1000),
    [contact_name] NVARCHAR(1000),
    [contact_email] NVARCHAR(1000),
    [is_active] BIT NOT NULL CONSTRAINT [customers_is_active_df] DEFAULT 1,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [customers_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL,
    CONSTRAINT [customers_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [customers_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[customer_parts] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [customer_id] BIGINT,
    [customer_part_number] NVARCHAR(1000) NOT NULL,
    [part_name] NVARCHAR(1000) NOT NULL,
    [product_type_id] BIGINT,
    [drawing_no] NVARCHAR(1000),
    [current_revision] NVARCHAR(1000),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [customer_parts_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL,
    CONSTRAINT [customer_parts_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[rfqs] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [rfq_number] NVARCHAR(1000) NOT NULL,
    [customer_part_id] BIGINT NOT NULL,
    [rfq_date] DATETIME2 NOT NULL CONSTRAINT [rfqs_rfq_date_df] DEFAULT CURRENT_TIMESTAMP,
    [required_date] DATETIME2,
    [annual_qty] DECIMAL(32,16),
    [batch_qty] DECIMAL(32,16),
    [currency] NVARCHAR(1000) NOT NULL CONSTRAINT [rfqs_currency_df] DEFAULT 'INR',
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [rfqs_status_df] DEFAULT 'DRAFT',
    [created_by] BIGINT NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [rfqs_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL,
    CONSTRAINT [rfqs_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [rfqs_rfq_number_key] UNIQUE NONCLUSTERED ([rfq_number])
);

-- CreateTable
CREATE TABLE [dbo].[rfq_versions] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [rfq_id] BIGINT NOT NULL,
    [revision_no] INT NOT NULL,
    [version_label] NVARCHAR(1000),
    [based_on_part_revision] NVARCHAR(1000),
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [rfq_versions_status_df] DEFAULT 'DRAFT',
    [is_current] BIT NOT NULL CONSTRAINT [rfq_versions_is_current_df] DEFAULT 1,
    [created_by] BIGINT NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [rfq_versions_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL,
    CONSTRAINT [rfq_versions_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [rfq_versions_rfq_id_revision_no_key] UNIQUE NONCLUSTERED ([rfq_id],[revision_no])
);

-- CreateTable
CREATE TABLE [dbo].[rfq_part_attributes] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [rfq_version_id] BIGINT NOT NULL,
    [material_category_id] BIGINT,
    [material_shape_id] BIGINT,
    [net_weight_kg] DECIMAL(32,16),
    [forging_loss_pct] DECIMAL(32,16),
    [dimensions] NVARCHAR(1000),
    [tolerances] NVARCHAR(1000),
    [surface_finish] NVARCHAR(1000),
    [hardness] NVARCHAR(1000),
    [heat_treatment] NVARCHAR(1000),
    [features] NVARCHAR(1000),
    [product_type_id] BIGINT,
    [ai_extracted] BIT NOT NULL CONSTRAINT [rfq_part_attributes_ai_extracted_df] DEFAULT 0,
    [reviewed] BIT NOT NULL CONSTRAINT [rfq_part_attributes_reviewed_df] DEFAULT 0,
    CONSTRAINT [rfq_part_attributes_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [rfq_part_attributes_rfq_version_id_key] UNIQUE NONCLUSTERED ([rfq_version_id])
);

-- CreateTable
CREATE TABLE [dbo].[rfq_materials] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [rfq_version_id] BIGINT NOT NULL,
    [material_size_config_id] BIGINT NOT NULL,
    [input_weight_kg] DECIMAL(32,16) NOT NULL,
    [rate_per_kg] DECIMAL(32,16) NOT NULL,
    [wastage_pct] DECIMAL(32,16) NOT NULL CONSTRAINT [rfq_materials_wastage_pct_df] DEFAULT 0,
    [material_cost] DECIMAL(32,16) NOT NULL,
    CONSTRAINT [rfq_materials_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[rfq_processes] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [rfq_version_id] BIGINT NOT NULL,
    [process_id] BIGINT NOT NULL,
    [machine_id] BIGINT,
    [method] NVARCHAR(1000) NOT NULL,
    [quantity_or_time] DECIMAL(32,16) NOT NULL,
    [rate] DECIMAL(32,16) NOT NULL,
    [cost] DECIMAL(32,16) NOT NULL,
    [sequence] INT NOT NULL,
    CONSTRAINT [rfq_processes_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[rfq_cost_summaries] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [rfq_version_id] BIGINT NOT NULL,
    [material_cost] DECIMAL(32,16) NOT NULL,
    [handling_cost] DECIMAL(32,16) NOT NULL,
    [machining_cost] DECIMAL(32,16) NOT NULL,
    [manual_cost] DECIMAL(32,16) NOT NULL,
    [subcontract_cost] DECIMAL(32,16) NOT NULL,
    [qc_cost] DECIMAL(32,16) NOT NULL,
    [mfg_cost] DECIMAL(32,16) NOT NULL,
    [admin_cost] DECIMAL(32,16) NOT NULL,
    [subtotal] DECIMAL(32,16) NOT NULL,
    [margin_pct] DECIMAL(32,16) NOT NULL,
    [margin_amount] DECIMAL(32,16) NOT NULL,
    [quoted_price_per_pc] DECIMAL(32,16) NOT NULL,
    [total_quote] DECIMAL(32,16) NOT NULL,
    [ai_recommended_margin_pct] DECIMAL(32,16),
    [computed_at] DATETIME2 NOT NULL CONSTRAINT [rfq_cost_summaries_computed_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [rfq_cost_summaries_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [rfq_cost_summaries_rfq_version_id_key] UNIQUE NONCLUSTERED ([rfq_version_id])
);

-- CreateTable
CREATE TABLE [dbo].[rfq_attachments] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [rfq_version_id] BIGINT NOT NULL,
    [file_name] NVARCHAR(1000) NOT NULL,
    [path] NVARCHAR(1000) NOT NULL,
    [mime] NVARCHAR(1000) NOT NULL,
    [uploaded_at] DATETIME2 NOT NULL CONSTRAINT [rfq_attachments_uploaded_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [rfq_attachments_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[rfq_references] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [rfq_version_id] BIGINT NOT NULL,
    [product_type_id] BIGINT,
    [material_category_id] BIGINT,
    [key_dims] NVARCHAR(1000),
    [quoted_price_per_pc] DECIMAL(32,16) NOT NULL,
    [outcome] NVARCHAR(1000) NOT NULL,
    [actual_cost] DECIMAL(32,16),
    CONSTRAINT [rfq_references_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [rfq_references_rfq_version_id_key] UNIQUE NONCLUSTERED ([rfq_version_id])
);

-- CreateTable
CREATE TABLE [dbo].[spec_analyses] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [customer_part_id] BIGINT NOT NULL,
    [attachment_id] BIGINT,
    [drawing_no] NVARCHAR(1000),
    [title] NVARCHAR(1000),
    [customer_name] NVARCHAR(1000),
    [co_no] NVARCHAR(1000),
    [revision] NVARCHAR(1000),
    [sheet_size] NVARCHAR(1000),
    [scale] NVARCHAR(1000),
    [material_note] NVARCHAR(1000),
    [designed_by] NVARCHAR(1000),
    [detailed_by] NVARCHAR(1000),
    [checked_by] NVARCHAR(1000),
    [drawn_date] DATETIME2,
    [product_type] NVARCHAR(1000),
    [overall_length_mm] DECIMAL(32,16),
    [max_od_mm] DECIMAL(32,16),
    [across_flats_mm] DECIMAL(32,16),
    [section_view] NVARCHAR(1000),
    [general_tol_table] NVARCHAR(1000),
    [notes] NVARCHAR(1000),
    [est_net_weight_kg] DECIMAL(32,16),
    [est_input_weight_kg] DECIMAL(32,16),
    [raw_extract] NVARCHAR(1000),
    [overall_confidence] DECIMAL(32,16),
    [reviewed] BIT NOT NULL CONSTRAINT [spec_analyses_reviewed_df] DEFAULT 0,
    [created_by] BIGINT,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [spec_analyses_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [spec_analyses_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [spec_analyses_customer_part_id_revision_key] UNIQUE NONCLUSTERED ([customer_part_id],[revision])
);

-- CreateTable
CREATE TABLE [dbo].[spec_analysis_items] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [spec_analysis_id] BIGINT NOT NULL,
    [item_type] NVARCHAR(1000) NOT NULL,
    [label] NVARCHAR(1000),
    [nominal_value] DECIMAL(32,16),
    [unit] NVARCHAR(1000),
    [tol_upper] DECIMAL(32,16),
    [tol_lower] DECIMAL(32,16),
    [tol_class] NVARCHAR(1000),
    [datum] NVARCHAR(1000),
    [gdt_type] NVARCHAR(1000),
    [raw_text] NVARCHAR(1000),
    [confidence] DECIMAL(32,16),
    [reviewed] BIT NOT NULL CONSTRAINT [spec_analysis_items_reviewed_df] DEFAULT 0,
    CONSTRAINT [spec_analysis_items_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- AddForeignKey
ALTER TABLE [dbo].[user_roles] ADD CONSTRAINT [user_roles_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[user_roles] ADD CONSTRAINT [user_roles_roleId_fkey] FOREIGN KEY ([roleId]) REFERENCES [dbo].[roles]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[material_categories] ADD CONSTRAINT [material_categories_material_type_id_fkey] FOREIGN KEY ([material_type_id]) REFERENCES [dbo].[material_types]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[material_size_configs] ADD CONSTRAINT [material_size_configs_material_category_id_fkey] FOREIGN KEY ([material_category_id]) REFERENCES [dbo].[material_categories]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[material_size_configs] ADD CONSTRAINT [material_size_configs_material_shape_id_fkey] FOREIGN KEY ([material_shape_id]) REFERENCES [dbo].[material_shapes]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[material_prices] ADD CONSTRAINT [material_prices_material_size_config_id_fkey] FOREIGN KEY ([material_size_config_id]) REFERENCES [dbo].[material_size_configs]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[handling_configs] ADD CONSTRAINT [handling_configs_material_type_id_fkey] FOREIGN KEY ([material_type_id]) REFERENCES [dbo].[material_types]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[customer_parts] ADD CONSTRAINT [customer_parts_customer_id_fkey] FOREIGN KEY ([customer_id]) REFERENCES [dbo].[customers]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[customer_parts] ADD CONSTRAINT [customer_parts_product_type_id_fkey] FOREIGN KEY ([product_type_id]) REFERENCES [dbo].[product_types]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[rfqs] ADD CONSTRAINT [rfqs_customer_part_id_fkey] FOREIGN KEY ([customer_part_id]) REFERENCES [dbo].[customer_parts]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[rfqs] ADD CONSTRAINT [rfqs_created_by_fkey] FOREIGN KEY ([created_by]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[rfq_versions] ADD CONSTRAINT [rfq_versions_rfq_id_fkey] FOREIGN KEY ([rfq_id]) REFERENCES [dbo].[rfqs]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[rfq_part_attributes] ADD CONSTRAINT [rfq_part_attributes_rfq_version_id_fkey] FOREIGN KEY ([rfq_version_id]) REFERENCES [dbo].[rfq_versions]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[rfq_materials] ADD CONSTRAINT [rfq_materials_rfq_version_id_fkey] FOREIGN KEY ([rfq_version_id]) REFERENCES [dbo].[rfq_versions]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[rfq_materials] ADD CONSTRAINT [rfq_materials_material_size_config_id_fkey] FOREIGN KEY ([material_size_config_id]) REFERENCES [dbo].[material_size_configs]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[rfq_processes] ADD CONSTRAINT [rfq_processes_rfq_version_id_fkey] FOREIGN KEY ([rfq_version_id]) REFERENCES [dbo].[rfq_versions]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[rfq_processes] ADD CONSTRAINT [rfq_processes_process_id_fkey] FOREIGN KEY ([process_id]) REFERENCES [dbo].[processes]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[rfq_processes] ADD CONSTRAINT [rfq_processes_machine_id_fkey] FOREIGN KEY ([machine_id]) REFERENCES [dbo].[machines]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[rfq_cost_summaries] ADD CONSTRAINT [rfq_cost_summaries_rfq_version_id_fkey] FOREIGN KEY ([rfq_version_id]) REFERENCES [dbo].[rfq_versions]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[rfq_attachments] ADD CONSTRAINT [rfq_attachments_rfq_version_id_fkey] FOREIGN KEY ([rfq_version_id]) REFERENCES [dbo].[rfq_versions]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[rfq_references] ADD CONSTRAINT [rfq_references_rfq_version_id_fkey] FOREIGN KEY ([rfq_version_id]) REFERENCES [dbo].[rfq_versions]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[spec_analyses] ADD CONSTRAINT [spec_analyses_customer_part_id_fkey] FOREIGN KEY ([customer_part_id]) REFERENCES [dbo].[customer_parts]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[spec_analysis_items] ADD CONSTRAINT [spec_analysis_items_spec_analysis_id_fkey] FOREIGN KEY ([spec_analysis_id]) REFERENCES [dbo].[spec_analyses]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
