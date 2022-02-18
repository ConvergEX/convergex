# -*- coding: utf-8 -*-

from odoo import models, fields


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    convergex_api_url = fields.Char(string="Convergex API URL", related="company_id.convergex_api_url", readonly=False)


class Company(models.Model):
    _inherit = 'res.company'

    convergex_api_url = fields.Char(string="Convergex API URL")
