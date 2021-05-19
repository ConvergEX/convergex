# -*- coding: utf-8 -*-
from odoo import models, fields


class StockPicking(models.Model):
    _name = 'stock.picking'
    _inherit = ['stock.picking', 'barcodes.barcode_events_mixin']

    def on_barcode_scanned(self, barcode):
        res = super(StockPicking, self).on_barcode_scanned(barcode)
        if 'warning' in res:
            # logic for product serial number
            lot_id = self.env['stock.production.lot'].search([('name', '=', barcode)], limit=1)
            if lot_id and lot_id.product_qty > 0:
                product = lot_id.product_id
                picking_move_lines = self.move_line_ids_without_package
                if not self.show_reserved:
                    picking_move_lines = self.move_line_nosuggest_ids

                corresponding_ml = picking_move_lines.filtered(lambda ml: ml.product_id.id == lot_id.product_id.id and not ml.lot_id)
                if corresponding_ml:
                    corresponding_ml[0].lot_id = lot_id.id
                    corresponding_ml[0].qty_done = 1.0
                    corresponding_ml[0].product_uom_qty = 1.0
                    return
                else:
                    new_move_line = self.move_line_ids.new({
                        'product_id': product.id,
                        'product_uom_id': product.uom_id.id,
                        'location_id': self.location_id.id,
                        'location_dest_id': self.location_dest_id.id,
                        'qty_done': 1.0,
                        'product_uom_qty': 1.0,
                        'date': fields.datetime.now(),
                        'lot_id': lot_id.id,
                    })
                    if self.show_reserved:
                        self.move_line_ids_without_package += new_move_line
                    else:
                        self.move_line_nosuggest_ids += new_move_line
                    return
        return res
