# -*- coding: utf-8 -*-
from odoo import api, models


class StockPicking(models.Model):
    _inherit = 'stock.picking'

    def _get_picking_fields_to_read(self):
        res = super(StockPicking, self)._get_picking_fields_to_read()
        res.append('x_studio_bag_')
        res.append('move_lines')
        return res

    def get_barcode_view_state(self):
        pickings = super(StockPicking, self).get_barcode_view_state()
        for picking in pickings:
            picking_id = self.browse(picking.get('id'))
            partner_name = picking_id.partner_id.x_studio_parent_company.name if picking_id.partner_id.x_studio_parent_company else ''
            x_studio_cost_centre = "[" + picking_id.x_studio_cost_centre + "] " if picking_id.x_studio_cost_centre else ''
            picking['owner_name'] = x_studio_cost_centre + partner_name
            picking['move_lines'] = self.env['stock.move'].browse(picking.pop('move_lines')).read(['product_id', 'product_uom_qty', 'product_uom'])
            for move_line_id in picking['move_line_ids']:
                product_move_id = self.env['stock.move'].search([('id', '=', move_line_id.get('move_id')[0])])
                move_line_id['product_move_qty'] = product_move_id.product_uom_qty
                move_line_id['move_product_uom'] = product_move_id.product_uom.name
                move_line_id['picking_type_code'] = picking['picking_type_code']
                if move_line_id.get('lot_id'):
                    lot_id = self.env['stock.production.lot'].search([('id', '=', move_line_id.get('lot_id')[0])])
                    move_line_id['cell'] = lot_id.x_studio_cell_
                    move_line_id['iccid'] = lot_id.x_studio_iccid_
                    move_line_id['imei'] = lot_id.x_studio_imei_
                    move_line_id['mac_address'] = lot_id.x_studio_mac_address__1
        return pickings

    @api.model
    def _get_move_line_ids_fields_to_read(self):
        move_line_ids_fields = super(StockPicking, self)._get_move_line_ids_fields_to_read()
        move_line_ids_fields.append('move_id')
        return move_line_ids_fields


class Product(models.Model):
    _inherit = 'product.product'

    def read_product_and_package(self, lot_ids=False, fetch_product=False):
        res = super(Product, self).read_product_and_package(lot_ids=lot_ids, fetch_product=fetch_product)
        if self._context.get('id'):
            picking_id = self.env['stock.picking'].browse(self._context.get('id'))
            move_id = picking_id.move_ids_without_package.filtered(lambda ml: ml.product_id.id == self.id)
            res['product_move_qty'] = move_id.product_uom_qty
            res['move_product_uom'] = move_id.product_uom.name
            res['x_studio_scan_descriptor'] = self.x_studio_scan_descriptor
            res['x_studio_scan_desc_2_1'] = self.x_studio_scan_desc_2_1
        return res

    def get_product_lot_info(self, lot_ids=False, fetch_product=False):
        for lot_id in lot_ids:
            lot_id = self.env['stock.production.lot'].browse(lot_id.get('id'))
            if self.x_studio_scan_descriptor == 'ICCID #' and not lot_id.x_studio_iccid_:
                return 'Missing Data: ICCID is not set in scanned Serial number.'
            if self.x_studio_scan_descriptor == 'IMEI #' and not lot_id.x_studio_imei_:
                return 'Missing Data: IMEI is not set in scanned Serial number.'
            if self.x_studio_scan_descriptor == 'MAC Address #' and not lot_id.x_studio_mac_address__1:
                return 'Missing Data: MAC Address is not set in scanned Serial number.'
            if self.x_studio_scan_desc_2_1 == 'Cell #' and not lot_id.x_studio_cell_:
                return 'Missing Data: Cell is not set in scanned Serial number.'
        return False
