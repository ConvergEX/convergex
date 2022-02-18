# -*- coding: utf-8 -*-
import json
from odoo import api, models, _
from odoo.exceptions import ValidationError
import requests


class StockPicking(models.Model):
    _inherit = 'stock.picking'

    def _get_picking_fields_to_read(self):
        res = super(StockPicking, self)._get_picking_fields_to_read()
        res.append('x_studio_bag_')
        res.append('move_lines')
        res.append('x_studio_waybill_')
        res.append('x_studio_waybill_url_')
        return res

    def get_barcode_view_state(self):
        pickings = super(StockPicking, self).get_barcode_view_state()
        for picking in pickings:
            picking_id = self.browse(picking.get('id'))
            partner_name = picking_id.partner_id.x_studio_parent_company.name if picking_id.partner_id.x_studio_parent_company else ''
            x_studio_cost_centre = "[" + picking_id.x_studio_cost_centre + "] " if picking_id.x_studio_cost_centre else ''
            picking['owner_name'] = x_studio_cost_centre + partner_name
            picking['owner_id'] = picking_id.partner_id.x_studio_parent_company.id
            picking['move_lines'] = self.env['stock.move'].browse(picking.pop('move_lines')).read(['product_id', 'product_uom_qty', 'product_uom'])
            for move_line_id in picking['move_line_ids']:
                product_move_id = self.env['stock.move'].search([('id', '=', move_line_id.get('move_id')[0])])
                move_line_id['product_move_qty'] = product_move_id.product_uom_qty
                move_line_id['move_product_uom'] = product_move_id.product_uom.name
                move_line_id['picking_type_code'] = picking['picking_type_code']
                move_line_id['x_studio_scan_descriptor'] = product_move_id.product_id.x_studio_scan_descriptor
                move_line_id['x_studio_scan_desc_2_1'] = product_move_id.product_id.x_studio_scan_desc_2_1
                if move_line_id.get('lot_id'):
                    lot_id = self.env['stock.production.lot'].search([('id', '=', move_line_id.get('lot_id')[0])])
                    move_line_id['cell'] = lot_id.x_studio_cell_ if lot_id.x_studio_cell_ else ''
                    move_line_id['iccid'] = lot_id.x_studio_iccid_ if lot_id.x_studio_iccid_ else ''
                    move_line_id['imei'] = lot_id.x_studio_imei_ if lot_id.x_studio_imei_ else ''
                    move_line_id['mac_address'] = lot_id.x_studio_mac_address__1 if lot_id.x_studio_mac_address__1 else ''
        return pickings

    @api.model
    def _get_move_line_ids_fields_to_read(self):
        move_line_ids_fields = super(StockPicking, self)._get_move_line_ids_fields_to_read()
        move_line_ids_fields.append('move_id')
        return move_line_ids_fields

    def open_barcode_picking(self, next_picking):
        picking_id = self.search([('state', 'in', ('assigned', 'confirmed')), ('picking_type_id', '=', self.picking_type_id.id)], order="id", limit=1)
        action = self.env["ir.actions.actions"]._for_xml_id("stock_barcode.stock_picking_action_kanban")
        action = {'stock_action': action}
        if picking_id and next_picking:
            action = self.env["ir.actions.actions"]._for_xml_id("stock_barcode.stock_barcode_picking_client_action")
            params = {
                'model': 'stock.picking',
                'picking_id': picking_id.id,
            }
            action = dict(action, target='fullscreen', params=params)
            action['context'] = {'active_id': picking_id.id}
            action = {'action': action}
        return action

    def button_validate(self):
        res = super(StockPicking, self).button_validate()
        if self.x_studio_waybill_ and self.x_studio_customer_reference and self.x_studio_bag_ and self.company_id.url:
            url = self.company_id.convergex_api_url
            package = []
            for move_line in self.move_line_ids:
                package_data = {
                    "stockCode": move_line.product_id.default_code,
                    "actualWeight": move_line.product_id.weight,
                    "dimWeight": move_line.product_id.volume,
                    "dimWidth": move_line.product_id.x_studio_width,
                    "dimHeight": move_line.product_id.x_studio_height,
                    "dimLength": move_line.product_id.x_studio_length,
                    "serialNo": move_line.lot_id.name,
                    "iccid": move_line.x_studio_iccid_,
                    "imei": move_line.x_studio_imei_,
                    "macAddr": move_line.x_studio_mac_address_,
                    "cell": move_line.x_studio_cell_
                }
                package.append(package_data)
            data = {
                    "convergex-update-serials": {
                        "waybillNo": self.x_studio_waybill_ or "",
                        "refNo": self.x_studio_customer_reference or "",
                        "bagNo": self.x_studio_bag_ or "",
                        "package": package
                    }
                }
            headers = {"Content-type": "application/json", "cache-control": "no-cache"}
            response = requests.request("POST", url, headers=headers, data=json.dumps(data))
            response_json = response.json()
            if response_json['package-serials']['status'] == "failed":
                raise ValidationError(_('%s.') % (response_json['package-serials']['reason']))
        return res


class StockMoveLine(models.Model):
    _inherit = 'stock.move.line'

    @api.model
    def create(self, values):
        picking_id = self.env['stock.picking'].browse(values.get('picking_id'))
        if picking_id.move_ids_without_package and self._context.get('form_view_ref') and picking_id.picking_type_id.code == 'outgoing':
            move_id = picking_id.move_ids_without_package.filtered(
                lambda ml: ml.product_id.id == values.get('product_id'))
            qty_done = 0
            if not move_id:
                raise ValidationError(_('You can not add this product.'))
            if values.get('qty_done'):
                qty_done = move_id.quantity_done + values.get('qty_done')
            if qty_done > move_id.product_uom_qty:
                raise ValidationError(
                    _('You can not add more than %s quantity of %s.') % (move_id.product_uom_qty, self.move_id.product_id.display_name))
        return super(StockMoveLine, self).create(values)

    def write(self, vals):
        if vals.get('qty_done') and self._context.get('form_view_ref') and self.move_id.picking_type_id.code == 'outgoing':
            qty_done = 0
            if vals.get('qty_done'):
                qty_done = self.move_id.quantity_done + vals.get('qty_done')
            if qty_done > self.move_id.product_uom_qty:
                raise ValidationError(
                    _('You can not add more than %s quantity of %s.') % (self.move_id.product_uom_qty, self.move_id.product_id.display_name))
        return super(StockMoveLine, self).write(vals)


class Product(models.Model):
    _inherit = 'product.product'

    def read_product_and_package(self, lot_ids=False, fetch_product=False):
        res = {}
        try:
            res = super(Product, self).read_product_and_package(lot_ids=lot_ids, fetch_product=fetch_product)
        except:
            res['message'] = 'No stock available in Picking location or The serial number has already been used'
            return res
        if self._context.get('id'):
            picking_id = self.env['stock.picking'].browse(self._context.get('id'))
            if picking_id and picking_id.picking_type_id.code == 'outgoing':
                move_id = picking_id.move_ids_without_package.filtered(lambda ml: ml.product_id.id == self.id)
                if move_id:
                    res['move_id'] = move_id[0].id
                    res['product_move_qty'] = move_id.product_uom_qty
                    res['move_product_uom'] = move_id.product_uom.name
                    res['x_studio_scan_descriptor'] = self.x_studio_scan_descriptor
                    res['x_studio_scan_desc_2_1'] = self.x_studio_scan_desc_2_1
                    res['message'] = False
                    if lot_ids:
                        res['message'] = self.get_product_lot_info(lot_ids, fetch_product)
        return res

    def get_product_lot_info(self, lot_ids=False, fetch_product=False):
        for lot_id in lot_ids:
            lot_id = self.env['stock.production.lot'].browse(lot_id)
            quant_id = self.env['stock.quant'].search([('lot_id', '=', lot_id.id), ('location_id.usage', '=', 'internal'), ('product_id', '=', self.id)], limit=1)
            if quant_id and quant_id.quantity < 1:
                return (_('The serial number has already been assigned: \n Product: %s, Serial Number: %s') % (quant_id.product_id.display_name, quant_id.lot_id.name))
            owner_id = self._context.get('owner_id')
            if not owner_id:
                return 'Serial number does not belong to the current owner.'
            owner_group = self.user_has_groups('stock.group_tracking_owner')
            if quant_id and owner_group:
                if not quant_id.owner_id:
                    return 'Serial number does not belong to the current owner.'
                if owner_id not in [quant_id.owner_id.id, quant_id.owner_id.x_studio_parent_company.id]:
                    return 'Serial number does not belong to the current owner.'
            if self.x_studio_scan_descriptor == 'ICCID #' and not lot_id.x_studio_iccid_:
                return 'Missing Data: ICCID is not set in scanned Serial number.'
            if self.x_studio_scan_descriptor == 'IMEI #' and not lot_id.x_studio_imei_:
                return 'Missing Data: IMEI is not set in scanned Serial number.'
            if self.x_studio_scan_descriptor == 'MAC Address #' and not lot_id.x_studio_mac_address__1:
                return 'Missing Data: MAC Address is not set in scanned Serial number.'
            if self.x_studio_scan_desc_2_1 == 'Cell #' and not lot_id.x_studio_cell_:
                return 'Missing Data: Cell is not set in scanned Serial number.'
        return False
