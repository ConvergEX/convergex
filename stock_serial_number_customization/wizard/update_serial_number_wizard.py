# -*- coding: utf-8 -*-

from odoo import models, fields, _
from odoo.exceptions import UserError


class UpdateSerialNumberWizard(models.TransientModel):
    _name = 'update.serial.number.wizard'
    _description = "Update serial number from move line"

    serial_number = fields.Char("Serial Number")

    def action_check_and_update_sn(self):
        move_line_id = self.env['stock.move.line'].browse(self._context.get('active_id'))
        if move_line_id and move_line_id.picking_code == 'outgoing':
            serial_no_id = self.env['stock.production.lot'].search([('product_id', '=', move_line_id.product_id.id), ('name', '=', self.serial_number)])
            if serial_no_id:
                if serial_no_id and serial_no_id.product_qty:
                    move_line_id.lot_id = serial_no_id.id
                    move_line_id.qty_done = 1.0
                else:
                    raise UserError(_('Stock not available for given lot'))
            else:
                raise UserError(_('Invalid given Serial Number'))
