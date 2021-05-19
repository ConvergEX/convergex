# -*- coding: utf-8 -*-
{
    'name': 'Stock Picking SN Scan, Update Customization',
    'summary': "Stock Picking SN Scan, Update Customization",
    'description': "Stock Picking SN Scan, Update Customization",

    'author': 'iPredict IT Solutions Pvt. Ltd.',
    'website': 'http://ipredictitsolutions.com',
    'support': 'ipredictitsolutions@gmail.com',

    'category': 'Inventory/Inventory Sale',
    'version': '14.0.0.1.0',
    'depends': ["stock_barcode"],

    'data': [
        "security/ir.model.access.csv",
        "wizard/update_serial_number_wizard.xml",
        "views/stock_move_view.xml"
    ],

    'license': "OPL-1",

    'auto_install': False,
    'installable': True,
}
