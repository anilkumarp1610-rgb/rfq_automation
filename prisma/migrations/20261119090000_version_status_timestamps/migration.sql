BEGIN TRY

BEGIN TRAN;

-- AlterTable: when a version was quoted / decided (won or lost), instead of guessing from updated_at
ALTER TABLE [dbo].[rfq_versions] ADD [quoted_at] DATETIME2,
[decided_at] DATETIME2;

-- Backfill existing rows: updated_at is the best available approximation (it is what the dashboard
-- used until now), so historical charts do not move. EXEC defers compilation until the columns exist.
EXEC('UPDATE [dbo].[rfq_versions] SET [quoted_at] = [updated_at] WHERE [status] IN (''QUOTED'', ''WON'', ''LOST'')');
EXEC('UPDATE [dbo].[rfq_versions] SET [decided_at] = [updated_at] WHERE [status] IN (''WON'', ''LOST'')');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
