BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[audit_logs] ALTER COLUMN [changes] NVARCHAR(max) NOT NULL;

-- AlterTable
ALTER TABLE [dbo].[qc_configs] ALTER COLUMN [inspection_standards] NVARCHAR(max) NULL;

-- AlterTable
ALTER TABLE [dbo].[rfq_part_attributes] ALTER COLUMN [dimensions] NVARCHAR(max) NULL;
ALTER TABLE [dbo].[rfq_part_attributes] ALTER COLUMN [tolerances] NVARCHAR(max) NULL;
ALTER TABLE [dbo].[rfq_part_attributes] ALTER COLUMN [features] NVARCHAR(max) NULL;

-- AlterTable
ALTER TABLE [dbo].[rfq_references] ALTER COLUMN [key_dims] NVARCHAR(max) NULL;

-- AlterTable
ALTER TABLE [dbo].[spec_analyses] ALTER COLUMN [general_tol_table] NVARCHAR(max) NULL;
ALTER TABLE [dbo].[spec_analyses] ALTER COLUMN [notes] NVARCHAR(max) NULL;
ALTER TABLE [dbo].[spec_analyses] ALTER COLUMN [raw_extract] NVARCHAR(max) NULL;

-- AlterTable
ALTER TABLE [dbo].[spec_analysis_items] ALTER COLUMN [raw_text] NVARCHAR(max) NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
