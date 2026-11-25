BEGIN TRY

BEGIN TRAN;

-- AddForeignKey
ALTER TABLE [dbo].[rfq_part_attributes] ADD CONSTRAINT [rfq_part_attributes_material_category_id_fkey] FOREIGN KEY ([material_category_id]) REFERENCES [dbo].[material_categories]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[rfq_part_attributes] ADD CONSTRAINT [rfq_part_attributes_material_shape_id_fkey] FOREIGN KEY ([material_shape_id]) REFERENCES [dbo].[material_shapes]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[rfq_part_attributes] ADD CONSTRAINT [rfq_part_attributes_product_type_id_fkey] FOREIGN KEY ([product_type_id]) REFERENCES [dbo].[product_types]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
