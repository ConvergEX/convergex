# -*- coding: utf-8 -*-
from odoo import models


class StockPicking(models.Model):
    _inherit = 'stock.picking'

    def _get_picking_fields_to_read(self):
        res = super(StockPicking, self)._get_picking_fields_to_read()
        res.append('x_studio_bag_')
        return res
