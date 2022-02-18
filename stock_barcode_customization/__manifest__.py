# -*- coding: utf-8 -*-
{
    'name': 'Stock Barcode Customization',
    'summary': "Stock Barcode Customizatio",
    'description': "Stock Barcode Customizatio",

    'author': 'iPredict IT Solutions Pvt. Ltd.',
    'website': 'http://ipredictitsolutions.com',
    'support': 'ipredictitsolutions@gmail.com',

    'category': 'Inventory/Inventory Sale',
    'version': '14.0.0.5.0',
    'depends': ["stock_barcode"],

    'data': [
        'views/assets.xml',
        'views/res_config.xml'
    ],

    'qweb': [
        'static/src/xml/templates.xml',
    ],

    'license': "OPL-1",

    'auto_install': False,
    'installable': True,
}

# 14.0.0.1.0
# --------------
# Requirement #1
# 1.1 Must be able scan view the Bag # in the barcode module
# 1.2. The sequence of scanning is important i.e. they scan bag # first, then the serial number next

# 14.0.0.2.0
# --------------
# Requirement #2
# Fields that that are critical to view in the barcodes module:
# 1. Bag # (Already covered in required #1)
# 2. Source location

# Details about products to be scanned
# 3. Product Name
# 4. Initial Demand
# 5. From Owner
# 6. Serial number
# 7. Scan descriptor field 1- Mac Address,
# 8. Scan descriptor field 2- IMEI
# 9. Scan descriptor field 3- ICCID
# 10. Scan descriptor field 4- Cell
# 11. Show product and demand on bar code
# 12. Show Owner before bag number

# 14.0.0.3.0
# --------------
# Requirement #3

# 3.1. While scan serial number product is set with scan option 1 &2 and any of that not available in serial number then show message like this is not set
# 3.2. Do not add line or update serial number if any of not available
# 3.3 Once an order has been confirmed it will have certain products and certain quantities as the initial demand By default, Odoo allows more quantities to be scanned than the initial order
# Prerence is that once an order has been confirmed, one should only be able to scan the products and quantities on the initial demand i.e. kind of locking the order of some sort
# 3.4 Check for owner if owner is not set or not match do not add line and show warning

# 14.0.0.4.0
# --------------
# Requirement #4
# Open next picking of selected operation type instead of picking kanban view

# 14.0.0.4.0
# --------------
# Requirement #5
# Add extra fields on bar code screen way bill and way bill URL with click able link

