BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[rfq_part_attributes] ADD [purchase_price_per_pc] DECIMAL(32,16),
[sourcing_type] NVARCHAR(1000) NOT NULL CONSTRAINT [rfq_part_attributes_sourcing_type_df] DEFAULT 'MANUFACTURED',
[supplier_name] NVARCHAR(1000);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
