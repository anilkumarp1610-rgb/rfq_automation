BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[spec_analyses] ADD [rfq_version_id] BIGINT;

-- AddForeignKey
ALTER TABLE [dbo].[spec_analyses] ADD CONSTRAINT [spec_analyses_rfq_version_id_fkey] FOREIGN KEY ([rfq_version_id]) REFERENCES [dbo].[rfq_versions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[spec_analyses] ADD CONSTRAINT [spec_analyses_attachment_id_fkey] FOREIGN KEY ([attachment_id]) REFERENCES [dbo].[rfq_attachments]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
