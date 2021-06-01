odoo.define('stock_barcode_customization.LinesWidget', function(require) {
    'use strict';

    var LinesWidget = require('stock_barcode.LinesWidget');
    var ClientAction = require('stock_barcode.ClientAction');
    var core = require('web.core');
    var QWeb = core.qweb;

    var _t = core._t;

    var BagNumber = LinesWidget.include({
        start: function() {
            var self = this;
            return this._super.apply(this, arguments).then(function() {
                return self._renderBag();
            });
        },
        _renderBag: function() {
            var $bag = this.$el.filter('.o_barcode_lines_header');
            var $pageBag = $(QWeb.render('stock_bag_number_template', {
                bagName: this.__parentedParent.initialState.x_studio_bag_,
                OperationType: this.__parentedParent.initialState.picking_type_code,
            }));
            $bag.append($pageBag);
        },

        /**
         * Updates the buttons to add quantities (updates written quantity or hides buttons).
         *
         * @private
         * @param {jQueryElement} $line
         */
        _updateIncrementButtons: function($line) {
            const id = $line.data('id');
            const qtyDone = parseFloat($line.find('.qty-done').text());
            const line = this.page.lines.find(l => id === (l.id || l.virtual_id));
            if (this.model === 'stock.inventory') {
                const hideAddButton = Boolean(
                    (line.product_id.tracking === 'serial' && (!line.prod_lot_id || line.product_qty > 0)) ||
                    (line.product_id.tracking === 'lot' && !line.prod_lot_id));
                const hideRemoveButton = (line.product_qty < 1);
                $line.find('.o_add_unit').toggleClass('d-none', hideAddButton);
                $line.find('.o_remove_unit').toggleClass('d-none', hideRemoveButton);
            } else {
                if (!line) {
                    return;
                }
                if (line.product_uom_qty === 0) {
                    // Does nothing it the line has no reserved quantity.
                    return;
                }
                if (qtyDone < line.product_uom_qty) {
                    const $button = $line.find('button[class*="o_add_"]');
                    const qty = line.product_uom_qty - qtyDone;
                    if (this.istouchSupported) {
                        // Updates the remaining quantities...
                        const $reservedButton = $button.filter('.o_add_reserved');
                        $button.data('reserved', qty);
                        $reservedButton.text(`+ ${qty}`);
                    } else if (this.shiftPressed) {
                        // Updates the remaining quantities...
                        $button.data('reserved', qty);
                        $button.text(`+ ${qty}`);
                        $button.toggleClass('o_add_reserved', true);
                        $button.toggleClass('o_add_unit', false);
                    } else {
                        $button.text(`+ 1`);
                        $button.toggleClass('o_add_unit', true);
                        $button.toggleClass('o_add_reserved', false);
                    }
                } else {
                    // hides the buttons since they are now useless.
                    $line.find('.o_line_button').hide();
                    // flag line so we know it doesn't need a shortcut key
                    $line.addClass('o_line_qty_completed');
                    if (!(line.product_id.tracking === 'serial' || line.product_id.tracking === 'lot') || line.lot_name) {
                        // move line to bottom of list
                        $line.parent().append($line);
                        // class for css
                        $line.addClass('o_line_completed');
                    }
                }
            }
        },
    });
    var ClientAction = ClientAction.include({

        /**
         * Handles the actions when a barcode is scanned, mainly by executing the appropriate step. If
         * we need to change page after the step is executed, it calls `this._save` and
         * `this._reloadLineWidget` with the new page index. Afterwards, we apply the appropriate logic
         * to `this.linesWidget`.
         *
         * @private
         * @param {String} barcode the scanned barcode
         * @returns {Promise}
         */
        _onBarcodeScanned: function(barcode) {
            var self = this;
            return this.stepsByName[this.currentStep || 'source'](barcode, []).then(function(res) {
                /* We check now if we need to change page. If we need to, we'll call `this.save` with the
                 * `new_location_id``and `new_location_dest_id` params so `this.currentPage` will
                 * automatically be on the new page. We need to change page when we scan a source or a
                 * destination location ; if the source or destination is different than the current
                 * page's one.
                 */
                var prom = Promise.resolve();
                var currentPage = self.pages[self.currentPageIndex];
                if (
                    (self.scanned_location &&
                        !self.scannedLines.length &&
                        self.scanned_location.id !== currentPage.location_id
                    ) ||
                    (self.scanned_location_dest &&
                        self.scannedLines.length &&
                        self.scanned_location_dest.id !== currentPage.location_dest_id
                    )
                ) {
                    // The expected locations are the scanned locations or the default picking locations.
                    var expectedLocationId = self.scanned_location.id;
                    var expectedLocationDestId;
                    if (self.actionParams.model === 'stock.picking') {
                        expectedLocationDestId = self.scanned_location_dest &&
                            self.scanned_location_dest.id ||
                            self.currentState.location_dest_id.id;
                    }

                    if (expectedLocationId !== currentPage.location_id ||
                        expectedLocationDestId !== currentPage.location_dest_id
                    ) {
                        var params = {
                            new_location_id: expectedLocationId,
                        };
                        if (expectedLocationDestId) {
                            params.new_location_dest_id = expectedLocationDestId;
                        }
                        prom = self._save(params).then(function() {
                            return self._reloadLineWidget(self.currentPageIndex);
                        });
                    }
                }

                // Apply now the needed actions on the different widgets.
                if (self.scannedLines && self.scanned_location_dest) {
                    self._endBarcodeFlow();
                }
                if (res) {
                    var linesActions = res.linesActions;
                    var always = function() {
                        _.each(linesActions, function(action) {
                            action[0].apply(self.linesWidget, action[1]);
                        });
                    };
                    prom.then(always).guardedCatch(always);
                }
                return prom;
            }, function(errorMessage) {
                self.do_warn(false, errorMessage);
            });
        },
        // -------------------------------------------------------------------------
        // Private: flow steps
        // -------------------------------------------------------------------------

        /**
         * Handle what needs to be done when a source location is scanned.
         *
         * @param {string} barcode scanned barcode
         * @param {Object} linesActions
         * @returns {Promise}
         */
        _step_source: function(barcode, linesActions) {
            var self = this;
            this.currentStep = 'source';
            this.stepState = $.extend(true, {}, this.currentState);
            var errorMessage;

            /* Bypass this step in the following cases:
               - the picking is a receipt
               - the multi location group isn't active
            */
            var sourceLocation = this.locationsByBarcode[barcode];
            if (sourceLocation && !(this.mode === 'receipt' || this.mode === 'no_multi_locations')) {
                // Sanity check: is the scanned location allowed in this document?
                if (!this.mode === 'inventory') {
                    const locationId = this._getLocationId();
                    if (locationId && !isChildOf(locationId, sourceLocation)) {
                        errorMessage = _t('This location is not a child of the main location.');
                        return Promise.reject(errorMessage);
                    }
                } else {
                    let isLocationAllowed = false;
                    if (this.currentState.location_ids) {
                        for (const locationId of this.currentState.location_ids) {
                            if (isChildOf(locationId, sourceLocation)) {
                                isLocationAllowed = true;
                                break;
                            }
                        }
                    } else {
                        isLocationAllowed = true;
                    }
                    if (!isLocationAllowed) {
                        errorMessage = _t('This location is not a child of the selected locations on the inventory adjustment.');
                        return Promise.reject(errorMessage);
                    }

                    linesActions.push([this.linesWidget.highlightLocation, [true]]);
                    if (this.actionParams.model === 'stock.picking') {
                        linesActions.push([this.linesWidget.highlightDestinationLocation, [false]]);
                    }
                    this.scanned_location = sourceLocation;
                    this.currentStep = 'product';
                    return Promise.resolve({ linesActions: linesActions });
                }
            }
            /* Implicitely set the location source in the following cases:
                - the user explicitely scans a product
                - the user explicitely scans a lot
                - the user explicitely scans a package
            */
            // We already set the scanned_location even if we're not sure the
            // following steps will succeed. They need scanned_location to work.
            this.scanned_location = {
                id: this.pages ? this.pages[this.currentPageIndex].location_id : this.currentState.location_id.id,
                display_name: this.pages ? this.pages[this.currentPageIndex].location_name : this.currentState.location_id.display_name,
            };

            linesActions.push([this.linesWidget.highlightLocation, [true]]);
            if (this.actionParams.model === 'stock.picking') {
                linesActions.push([this.linesWidget.highlightDestinationLocation, [false]]);
            }

            return this._step_product(barcode, linesActions).then(function(res) {
                return Promise.resolve({ linesActions: res.linesActions });
            }, function(specializedErrorMessage) {
                delete self.scanned_location;
                self.currentStep = 'source';
                debugger;
                if (specializedErrorMessage) {
                    return Promise.reject(specializedErrorMessage);
                }

                if (self.currentState.picking_type_code == 'outgoing') {
                    if (!self.currentState.x_studio_bag_) {
                        var errorMessage = _t('Please Scan Bag first before adding product.');
                        return Promise.reject(errorMessage);
                    }

                } else {
                    var errorMessage = _t('You are expected to scan a source location.');
                    return Promise.reject(errorMessage);

                }
            });
        },

        /**
         * Handle what needs to be done when a product is scanned.
         *
         * @param {string} barcode scanned barcode
         * @param {Object} linesActions
         * @returns {Promise}
         */
        _step_product: function(barcode, linesActions) {
            var self = this;
            this.currentStep = 'product';
            this.stepState = $.extend(true, {}, this.currentState);
            var errorMessage;

            var product = this._isProduct(barcode);
            if (product) {
                debugger;
                if (!self.currentState.x_studio_bag_ && self.currentState.picking_type_code == 'outgoing') {
                    errorMessage = _t('Please Scan Bag first before adding product.');
                    return Promise.reject(errorMessage);
                }
                if (product.tracking !== 'none' && self.requireLotNumber) {
                    this.currentStep = 'lot';
                }
                var res = this._incrementLines({ 'product': product, 'barcode': barcode });
                if (res.isNewLine) {
                    if (this.actionParams.model === 'stock.inventory') {
                        // FIXME sle: add owner_id, prod_lot_id, owner_id, product_uom_id
                        return this._rpc({
                            model: 'product.product',
                            method: 'get_theoretical_quantity',
                            args: [
                                res.lineDescription.product_id.id,
                                res.lineDescription.location_id.id,
                            ],
                        }).then(function(theoretical_qty) {
                            res.lineDescription.theoretical_qty = theoretical_qty;
                            linesActions.push([self.linesWidget.addProduct, [res.lineDescription, self.actionParams.model]]);
                            self.scannedLines.push(res.id || res.virtualId);
                            return Promise.resolve({ linesActions: linesActions });
                        });
                    } else {
                        linesActions.push([this.linesWidget.addProduct, [res.lineDescription, this.actionParams.model]]);
                    }
                } else if (!(res.id || res.virtualId)) {
                    return Promise.reject(_("There are no lines to increment."));
                } else {
                    if (product.tracking === 'none' || !self.requireLotNumber) {
                        linesActions.push([this.linesWidget.incrementProduct, [res.id || res.virtualId, product.qty || 1, this.actionParams.model]]);
                    } else {
                        linesActions.push([this.linesWidget.incrementProduct, [res.id || res.virtualId, 0, this.actionParams.model]]);
                    }
                }
                this.scannedLines.push(res.id || res.virtualId);
                return Promise.resolve({ linesActions: linesActions });
            } else {
                var success = function(res) {
                    return Promise.resolve({ linesActions: res.linesActions });
                };
                var fail = function(specializedErrorMessage) {
                    debugger;
                    self.currentStep = 'product';
                    if (specializedErrorMessage == 'The scanned lot does not match an existing one.') {
                        if (!self.currentState.x_studio_bag_ && self.currentState.picking_type_code == 'outgoing') {
                            self.currentState.x_studio_bag_ = barcode;

                            return self._save().then(() => {
                                return self._rpc({
                                    model: 'stock.picking',
                                    method: 'write',
                                    args: [
                                        [self.currentState.id], {
                                            x_studio_bag_: barcode,
                                        }
                                    ],
                                }).then(function() {
                                    $('.bag_number_summary').append(barcode);
                                    return Promise.resolve();
                                });
                            });
                        }
                    }
                    if (specializedErrorMessage) {
                        return Promise.reject(specializedErrorMessage);
                    }
                    if (!self.scannedLines.length) {
                        if (!self.currentState.x_studio_bag_ && self.currentState.picking_type_code == 'outgoing') {
                            self.currentState.x_studio_bag_ = barcode;

                            return self._save().then(() => {
                                return self._rpc({
                                    model: 'stock.picking',
                                    method: 'write',
                                    args: [
                                        [self.currentState.id], {
                                            x_studio_bag_: barcode,
                                        }
                                    ],
                                }).then(function() {
                                    $('.bag_number_summary').append(barcode);
                                    return Promise.resolve({ linesActions: linesActions });
                                });
                            });
                        }
                        if (self.currentState.x_studio_bag_ && self.currentState.x_studio_bag_ == barcode && self.currentState.picking_type_code == 'outgoing') {
                            errorMessage = _t('Bag number already set with current picking operation.');
                            return Promise.reject(errorMessage);
                        }
                        if (self.groups.group_tracking_lot) {
                            errorMessage = _t("You are expected to scan one or more products or a package available at the picking's location");
                        } else {
                            errorMessage = _t('You are expected to scan one or more products.');
                        }
                        return Promise.reject(errorMessage);
                    }
                    var destinationLocation = self.locationsByBarcode[barcode];
                    if (destinationLocation) {
                        return self._step_destination(barcode, linesActions);
                    } else {
                        errorMessage = _t('You are expected to scan more products or a destination location.');
                        return Promise.reject(errorMessage);
                    }
                };
                return self._step_lot(barcode, linesActions).then(success, function(res) {
                    return self._step_package(barcode, linesActions).then(success, fail(res));
                });
            }
        },
        _step_lot: function(barcode, linesActions) {
            if (!this.groups.group_production_lot || !this.requireLotNumber) {
                return Promise.reject();
            }
            this.currentStep = 'lot';
            this.stepState = $.extend(true, {}, this.currentState);
            var errorMessage;
            var self = this;

            // Bypass this step if needed.
            if (this.productsByBarcode[barcode]) {
                return this._step_product(barcode, linesActions);
            } else if (this.locationsByBarcode[barcode]) {
                return this._step_destination(barcode, linesActions);
            }

            var getProductFromLastScannedLine = function() {
                if (self.scannedLines.length) {
                    var idOrVirtualId = self.scannedLines[self.scannedLines.length - 1];
                    var line = _.find(self._getLines(self.currentState), function(line) {
                        return line.virtual_id === idOrVirtualId || line.id === idOrVirtualId;
                    });
                    if (line) {
                        var product = self.productsByBarcode[line.product_barcode || line.product_id.barcode];
                        // Product was added by lot or package
                        if (!product) {
                            return false;
                        }
                        product.barcode = line.product_barcode || line.product_id.barcode;
                        return product;
                    }
                }
                return false;
            };

            var getProductFromCurrentPage = function() {
                return _.map(self.pages[self.currentPageIndex].lines, function(line) {
                    return line.product_id.id;
                });
            };

            var getProductFromOperation = function() {
                return _.map(self._getLines(self.currentState), function(line) {
                    return line.product_id.id;
                });
            };

            var readProductQuant = function(product_id, lots) {
                var advanceSettings = self.groups.group_tracking_lot || self.groups.group_tracking_owner;
                var product_barcode = _.findKey(self.productsByBarcode, function(product) {
                    return product.id === product_id;
                });
                var product = false;
                var prom = Promise.resolve();

                if (product_barcode) {
                    product = self.productsByBarcode[product_barcode];
                    product.barcode = product_barcode;
                }

                if (!product || advanceSettings) {
                    var lot_ids = _.map(lots, function(lot) {
                        return lot.id;
                    });
                    prom = self._rpc({
                        model: 'product.product',
                        method: 'read_product_and_package',
                        args: [product_id],
                        kwargs: {
                            lot_ids: advanceSettings ? lot_ids : false,
                            fetch_product: !(product),
                        },
                    });
                }

                return prom.then(function(res) {
                    product = product || res.product;
                    var lot = _.find(lots, function(lot) {
                        return lot.product_id[0] === product.id;
                    });
                    var data = {
                        lot_id: lot.id,
                        lot_name: lot.display_name,
                        product: product
                    };
                    if (res && res.quant) {
                        data.package_id = res.quant.package_id;
                        data.owner_id = res.quant.owner_id;
                    }
                    return Promise.resolve(data);
                });
            };

            var getLotInfo = function(lots) {
                var products_in_lots = _.map(lots, function(lot) {
                    return lot.product_id[0];
                });
                var products = getProductFromLastScannedLine();
                var product_id = _.intersection(products, products_in_lots);
                if (!product_id.length) {
                    products = getProductFromCurrentPage();
                    product_id = _.intersection(products, products_in_lots);
                }
                if (!product_id.length) {
                    products = getProductFromOperation();
                    product_id = _.intersection(products, products_in_lots);
                }
                if (!product_id.length) {
                    product_id = [lots[0].product_id[0]];
                }
                return readProductQuant(product_id[0], lots);
            };

            var searchRead = function(barcode) {
                // Check before if it exists reservation with the lot.
                var lines_with_lot = _.filter(self.currentState.move_line_ids, function(line) {
                    return (line.lot_id && line.lot_id[1] === barcode) || line.lot_name === barcode;
                });
                var line_with_lot;
                if (lines_with_lot.length > 0) {
                    var line_index = 0;
                    // Get last scanned product if several products have the same lot name
                    var last_product = lines_with_lot.length > 1 && getProductFromLastScannedLine();
                    if (last_product) {
                        var last_product_index = _.findIndex(lines_with_lot, function(line) {
                            return line.product_id && line.product_id.id === last_product.id;
                        });
                        if (last_product_index > -1) {
                            line_index = last_product_index;
                        }
                    }
                    line_with_lot = lines_with_lot[line_index];
                }
                var def;
                if (line_with_lot) {
                    def = Promise.resolve([{
                        name: barcode,
                        display_name: barcode,
                        id: line_with_lot.lot_id[0],
                        product_id: [line_with_lot.product_id.id, line_with_lot.display_name],
                    }]);
                } else {
                    def = self._rpc({
                        model: 'stock.production.lot',
                        method: 'search_read',
                        domain: [
                            ['name', '=', barcode]
                        ],
                    });
                }
                return def.then(function(res) {
                    if (!res.length) {
                        errorMessage = _t('The scanned lot does not match an existing one.');
                        return Promise.reject(errorMessage);
                    }
                    return getLotInfo(res);
                });
            };

            var create = function(barcode, product) {
                return self._rpc({
                    model: 'stock.production.lot',
                    method: 'create',
                    args: [{
                        'name': barcode,
                        'product_id': product.id,
                        'company_id': self.currentState.company_id[0],
                    }],
                });
            };

            var def;
            if (this.currentState.use_create_lots &&
                !this.currentState.use_existing_lots) {
                // Do not create lot if product is not set. It could happens by a
                // direct lot scan from product or source location step.
                var product = getProductFromLastScannedLine();
                if (!product || product.tracking === "none") {
                    return Promise.reject();
                }
                def = Promise.resolve({ lot_name: barcode, product: product });
            } else if (!this.currentState.use_create_lots &&
                this.currentState.use_existing_lots) {
                def = searchRead(barcode);
            } else {
                def = searchRead(barcode).then(function(res) {
                    return Promise.resolve(res);
                }, function(errorMessage) {
                    var product = getProductFromLastScannedLine();
                    if (product && product.tracking !== "none") {
                        return create(barcode, product).then(function(lot_id) {
                            return Promise.resolve({ lot_id: lot_id, lot_name: barcode, product: product });
                        });
                    }
                    return Promise.reject(errorMessage);
                });
            }
            return def.then(function(lot_info) {
                var product = lot_info.product;
                if (product.tracking === 'serial' && self._lot_name_used(product, barcode)) {
                    errorMessage = _t('The scanned serial number is already used.');
                    return Promise.reject(errorMessage);
                }
                if (!self.currentState.x_studio_bag_ && self.currentState.picking_type_code == 'outgoing') {
                    errorMessage = _t('Please Scan Bag first before adding product.');
                    if (lot_info) {
                        return Promise.reject(errorMessage);
                    }
                }
                var res = self._incrementLines({
                    'product': product,
                    'barcode': lot_info.product.barcode,
                    'lot_id': lot_info.lot_id,
                    'lot_name': lot_info.lot_name,
                    'owner_id': lot_info.owner_id,
                    'package_id': lot_info.package_id,
                });
                if (res.isNewLine) {
                    function handle_line() {
                        self.scannedLines.push(res.lineDescription.virtual_id);
                        linesActions.push([self.linesWidget.addProduct, [res.lineDescription, self.actionParams.model]]);
                    }

                    if (self.actionParams.model === 'stock.inventory') {
                        // TODO deduplicate: this code is almost the same as in _step_product
                        return self._rpc({
                            model: 'product.product',
                            method: 'get_theoretical_quantity',
                            args: [
                                res.lineDescription.product_id.id,
                                res.lineDescription.location_id.id,
                                res.lineDescription.prod_lot_id[0],
                            ],
                        }).then(function(theoretical_qty) {
                            res.lineDescription.theoretical_qty = theoretical_qty;
                            handle_line();
                            return Promise.resolve({ linesActions: linesActions });
                        });
                    }
                    handle_line();

                } else {
                    if (self.scannedLines.indexOf(res.lineDescription.id) === -1) {
                        self.scannedLines.push(res.lineDescription.id || res.lineDescription.virtual_id);
                    }
                    linesActions.push([self.linesWidget.incrementProduct, [res.id || res.virtualId, 1, self.actionParams.model]]);
                    linesActions.push([self.linesWidget.setLotName, [res.id || res.virtualId, barcode]]);
                }
                return Promise.resolve({ linesActions: linesActions });
            });
        },

    });
});