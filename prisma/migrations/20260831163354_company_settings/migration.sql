BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[company_settings] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [singleton] BIT NOT NULL CONSTRAINT [company_settings_singleton_df] DEFAULT 1,
    [name] NVARCHAR(1000) NOT NULL,
    [address] NVARCHAR(max),
    [phone] NVARCHAR(1000),
    [email] NVARCHAR(1000),
    [website] NVARCHAR(1000),
    [gst_no] NVARCHAR(1000),
    [logo] NVARCHAR(max),
    [footer_note] NVARCHAR(max),
    [updated_at] DATETIME2 NOT NULL,
    [updated_by] BIGINT,
    CONSTRAINT [company_settings_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [company_settings_singleton_key] UNIQUE NONCLUSTERED ([singleton])
);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
