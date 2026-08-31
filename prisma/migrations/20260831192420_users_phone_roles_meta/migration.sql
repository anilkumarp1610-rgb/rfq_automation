BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[roles] ADD [description] NVARCHAR(max),
[is_system] BIT NOT NULL CONSTRAINT [roles_is_system_df] DEFAULT 0;

-- AlterTable
ALTER TABLE [dbo].[users] ADD [phone] NVARCHAR(1000);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
