BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[handling_configs] ADD CONSTRAINT [handling_configs_procurement_pct_df] DEFAULT 0 FOR [procurement_pct], CONSTRAINT [handling_configs_storage_pct_df] DEFAULT 0 FOR [storage_pct], CONSTRAINT [handling_configs_transportation_rate_df] DEFAULT 0 FOR [transportation_rate], CONSTRAINT [handling_configs_transportation_uom_df] DEFAULT 'FIXED' FOR [transportation_uom];
ALTER TABLE [dbo].[handling_configs] ADD [packing_cost] DECIMAL(32,16) NOT NULL CONSTRAINT [handling_configs_packing_cost_df] DEFAULT 0,
[packing_mode] NVARCHAR(1000) NOT NULL CONSTRAINT [handling_configs_packing_mode_df] DEFAULT 'FIXED';

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
