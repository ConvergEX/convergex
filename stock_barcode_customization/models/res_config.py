# -*- coding: utf-8 -*-

from odoo import models, fields


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    url = fields.Char(related="company_id.url", readonly=False)


class Company(models.Model):
    _inherit = 'res.company'

    url = fields.Char(string="URL")
