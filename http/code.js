// datatables-tool.js

var allSettings

// Handle AJAX type errors
var handle_ajax_error = function(jqXHR, textStatus, errorThrown) {
  $('body > .dataTables_processing').remove()
  if(jqXHR.responseText.match(/database file does not exist/) != null){
    $('body').html('<div class="problem"><h4>This dataset is empty.</h4><p>Once your dataset contains data,<br/>it will show up in a table here.</p></div>')
  } else if(jqXHR.responseText.match(/Gateway Time-out/) != null){
    $('body').html('<div class="problem"><h4>This dataset is too big.</h4><p>Well this is embarassing. Your dataset is too big for the <em>View in a table tool</em> to display.</p><p>Try downloading it as a spreadsheet.</p></div>')
  } else {
    scraperwiki.alert(errorThrown, jqXHR.responseText, "error")
  }
}

// http://stackoverflow.com/questions/7740567/escape-markup-in-json-driven-jquery-datatable
function htmlEncode(value) {
  return $('<div/>').text(value).html();
}
function htmlDecode(value) {
  return $('<div/>').html(value).text();
}

// Links clickable etc. in one row of data
var prettifyCell = function( content ) {
  content = $.trim(content)

  escaped_content = htmlEncode(content)

  // convert images to themselves embedded.
  // XXX _normal is to match Twitter images, watch for it causing trouble
  // e.g. https://si0.twimg.com/profile_images/2559953209/pM981LrS_normal - remove it
  if (content.match(/^((http|https|ftp):\/\/[a-zA-Z0-9-_~#:\.\?%&\/\[\]@\!\$'\(\)\*\+,;=]+(\.jpeg|\.png|\.jpg|\.gif|\.bmp|_normal))$/ig)) {
    content = '<img src="' + escaped_content + '" class="inline">'
  }
  // match LinkedIn image URLs, which always have "licdn.com/mpr/mpr" in them.
  // e.g. http://m3.licdn.com/mpr/mprx/0_oCf8SHoyvJ0Wq_CEo87xSEoAvRHIq5CEe_R0SEw2EOpRI3voQk0uio0GUveqBC_QITDYCDvcT0rm
  else if (content.match(/^((http|https|ftp):\/\/[a-z0-9\.]+licdn.com\/mpr\/mpr[a-zA-Z0-9-_~#:\.\?%&\/\[\]@\!\$'\(\)\*\+,;=]+)$/ig)) {
    content = '<img src="' + escaped_content + '" class="inline">'
  }
  // add links onto URLs:
  else if (content.match(/^((http|https|ftp):\/\/[a-zA-Z0-9-_~#:\.\?%&\/\[\]@\!\$'\(\)\*\+,;=]+)$/g)) {
    less_30 = escaped_content
    if (content.length > 30) {
      less_30 = htmlEncode(content.substr(0,30)) + "&hellip;"
    }
    content = '<a href="' + escaped_content + '" target="_blank">' + less_30 + '</a>'
  }
  else {
    less_500 = escaped_content
    if (content.length > 500) {
      less_500 = htmlEncode(content.substr(0,500)) + "<span title='" + content.length + " characters in total'>&hellip;</span>"
    }
    content = less_500
  }

  return content
}

// Save known state of all tabs, and active tab
var saveState = function (oSettings, oData) {
  allSettings['active'] = currentActiveTable
  allSettings['tables'][currentActiveTable] = oData

  var j = JSON.stringify(allSettings)
  var fname = escapeshell("allSettings.json")
  scraperwiki.exec("echo -n <<ENDOFJSON >" + fname + ".new.$$ " + escapeshell(j) + "\nENDOFJSON\n" +
    "mv " + fname + ".new.$$ " + fname,
    function(content) {
      if (content != "") {
        scraperwiki.alert("Unexpected saveState response!", content, "error")
      }
    }, handle_ajax_error
  )
}

// Restore column status from the view's box's filesystem
var loadState = function (oSettings) {
  if (currentActiveTable in allSettings['tables']) {
    oData = allSettings['tables'][currentActiveTable]
    // force the display length we calculated was suitable when first making the table
    // (rather than using the saved setting)
    oData.iLength = oSettings._iDisplayLength
  } else {
    oData = false
  }
  return oData
}


// Read active table from the box's filesystem and pass it on to callback
var loadAllSettings = function(callback) {
  var oData = false
  scraperwiki.exec("touch allSettings.json; cat allSettings.json" ,
    function(content) {
      try {
        allSettings = JSON.parse(content)
      } catch (e) {
        allSettings = { tables: {}, active: null }
      }
      callback()
    }, handle_ajax_error
  )
}

// Escape identifiers
var escapeSQL = function(column_name) {
  return '"' + column_name.replace(/"/g, '""') + '"'
}
var escapeshell = function(cmd) {
    return "'"+cmd.replace(/'/g,"'\\''")+"'";
}

// Function to map JSON data between DataTables format and ScraperWiki's SQL endpoint format.
// It returns a function for the fnServerData parameter
var convertData = function(table_name, column_names) {
  // This is a wrapper round the GET request DataTables makes to get more data
  // sSource - the URL, we don't use it, we hard code it instead
  // aoData - contains the URL parameters, e.g. what page, what to filter, what order and so on
  // fnCallback - where to call with the data you get back
  // oSettings - settings object for the whole DataTables, see http://datatables.net/docs/DataTables/1.9.0/DataTable.models.oSettings.html
  return function ( sSource, aoData, fnCallback, oSettings ) {
    // convert aoData into a normal hash (called ps)
    var params = {}
    for (var i=0;i<aoData.length;i++) {
      params[aoData[i].name] = aoData[i].value
    }

    // construct SQL query needed according to the parameters
    var order_by = ""
    if (params.iSortingCols >= 1) {
      var order_parts = []
      for (var i = 0; i < params.iSortingCols; i++) {
        order_part = escapeSQL(column_names[params["iSortCol_" + i]])
        if (params["sSortDir_" + i] == 'desc') {
          order_part += " desc"
        } else if (params["sSortDir_" + i] != 'asc') {
          scraperwiki.alert("Got unknown sSortDir_" + i + " value in table " + table_name)
        }
        order_parts.push(order_part)
      }
      order_by = " order by " + order_parts.join(",")
    }
    var where = ""
    if (params.sSearch) {
      var search = "'%" + params.sSearch.toLowerCase().replace("%", "$%").replace("_", "$_").replace("$", "$$") + "%'"
      where = " where " + _.map(column_names, function(n) { return "lower(" + escapeSQL(n) + ") like " + search + " escape '$'"}).join(" or ")
      if (where.length > 1500) {
        scraperwiki.alert("Filtering is unavailable.", "Your dataset has too many columns")
        $(".search-query").val("").trigger("keyup")
        return
      }
    }
    var query = "select * " +
           " from " + escapeSQL(table_name) +
         where +
         order_by +
           " limit " + params.iDisplayLength +
           " offset " + params.iDisplayStart

    var counts
    var rows = []
    async.parallel([
      function(cb) {
        // get column counts
        scraperwiki.sql("select (select count(*) from " + escapeSQL(table_name) + ") as total, (select count(*) from " + escapeSQL(table_name) + where + ") as display_total", function (data) {
          counts = data[0]
          cb()
        }, handle_ajax_error)
      }, function(cb) {
        oSettings.jqXHR = $.ajax( {
          "dataType": 'json',
          "type": "GET",
          "url": sqliteEndpoint,
          "data": { q: query },
          "success": function ( response ) {
            // ScraperWiki returns a list of dicts. This converts it to a list of lists.
            for (var i=0;i<response.length;i++) {
              var row = []
              _.each(meta.table[table_name].columnNames, function(col) {
                row.push(prettifyCell(response[i][col]))
              })
              rows.push(row)
            }
            cb()
          },
          "error": handle_ajax_error
        });
      }], function() {
        // Send the data to dataTables
        fnCallback({
          "aaData" : rows,
          "iTotalRecords": counts.total, // without filtering
          "iTotalDisplayRecords": counts.display_total // after filtering
        })
      }
    )
  }
}

// Make one of the DataTables (in one tab)
// 'i' should be the integer position of the datatable in the list of all tables
// 'table_name' is obviously the name of the active table
var constructDataTable = function(i, table_name) {
  // Find or make the table
  $(".maintable").hide()
  var id = "table_" + i
  var $outer = $("#" + id)
  if ($outer.length == 0) {
    $outer = $('<div class="maintable" id="table_' + i + '"> <table class="table table-striped table-bordered innertable display"></table> </div>')
    $('body').append($outer)
  } else {
    $outer.show()
    return
  }
  var $t = $outer.find("table")

  // Find out the column names
  column_names = meta.table[table_name].columnNames
  if (column_names.length == 0) {
    scraperwiki.alert("No columns in the table", jqXHR.responseText)
    return
  }

  // Make the column headings
      var thead = '<thead><tr>'
  _.each(column_names, function(column_name) {
    thead += '<th>' + column_name + '</th>'
  })
  thead += '</tr></thead>'
  $t.append(thead)

  // Show less rows the more columns there are (for large tables to load quicker)
  var num_columns = column_names.length
  var rows_to_show = 500
  if (num_columns >= 10) {
    rows_to_show = 250
  }
  if (num_columns >= 20) {
    rows_to_show = 100
  }
  if (num_columns >= 40) {
    rows_to_show = 50
  }

  // Fill in the datatables object
  window.currentTable = $t.dataTable({
    "bProcessing": true,
    "bServerSide": true,
    "bDeferRender": true,
    "bPaginate": true,
    "bFilter": true,
    "iDisplayLength": rows_to_show,
    "bScrollCollapse": true,
    "sDom": 'r<"table_controls"p<"form-search"<"input-append">>i><"table_wrapper"t>',
    "sPaginationType": "bootstrap",
    "fnServerData": convertData(table_name, column_names),
    "fnInitComplete": function(oSettings){
      if (oSettings.aoColumns.length > 30){
        // Remove search box if there are so many columns the ajax request
        // would cause a 414 Request URI Too Large error on wide datasets
        $('#table_' + i + ' .input-append').empty()
      } else {
        // Otherwise, append search box and handle clicks / enter key
        var $btn = $('<button class="btn">Search</button>').on('click', function(){
          searchTerm = $(this).prev().val()
          window.currentTable.fnFilter(searchTerm)
        })
        var $input = $('<input type="search" class="input-medium search-query">').on('keypress', function(e){
          if (e.which === 13) {
            $(this).next().trigger('click')
          }
        }).val(oSettings.oLoadedState.oSearch.sSearch)
        $('#table_' + i + ' .input-append').html($input).append($btn)
      }
    },
    "bStateSave": true,
    "fnStateSave": saveState,
    "fnStateLoad": loadState,
    "oLanguage": {
      "sEmptyTable": "This table is empty"
     }
  })
}

// Create and insert spreadsheet-like tab bar at top of page.
// 'tables' should be a list of table names.
// 'active_table' should be the one you want to appear selected.
var constructTabs = function(tables, active_table){
  var underscoreTables = []
  var $ul = $('<ul>').addClass('nav nav-tabs').appendTo('body')
  $.each(tables, function(i, table_name){
    var li = '<li id="tab_' + i + '">'
    if (table_name == active_table){
      var li = '<li id="tab_' + i + '" class="active">'
      currentActiveTable = table_name
      currentActiveTableIndex = i
    }
    var $a = $('<a href="#">' + table_name + '</a>')
    var $li = $(li).append($a).bind('click', function(e){
      e.preventDefault()
      $(this).addClass('active').siblings('.active').removeClass('active')
      currentActiveTable = table_name
      currentActiveTableIndex = i
      constructDataTable(i, table_name)
    })
    if(isDevTable(table_name)){
      $a.addClass('muted')
    }
    $ul.append($li)
  })
}

// Short functions to weed out non-user-facing tables
var isHiddenTable = function(table_name){
  return table_name.slice(0,2)=='__'
}
var isDevTable = function(table_name){
  return table_name.slice(0,1)=='_' && !isHiddenTable(table_name)
}

// Make all the DataTables and their tabs
var constructDataTables = function(first_table_name) {
  if ( ! first_table_name || ! first_table_name in _.values(tables) ) {
    // set a sensible default (in the case that there are no non-underscore tables)
    first_table_name = tables[0]
    // find the first non-underscore table
    $.each(tables, function(i, table_name){
      if(!isDevTable(table_name)){
        first_table_name = table_name
        return true
      }
    })
  }
  constructTabs(tables, first_table_name)
  $("#tab_" + currentActiveTableIndex).trigger('click')
}

// Get table names in the right order, ready for display
var filter_and_sort_tables = function(messy_table_names) {
  // Filter out tables starting with double underscore
  nice_tables = _.reject(messy_table_names, isHiddenTable)
  // Put tables beginning with a single underscore at the end
  return _.reject(nice_tables, isDevTable).concat(_.filter(nice_tables, isDevTable))
}

// Main entry point, make the data table
var settings
var sqliteEndpoint
var tables
var currentActiveTable
var currentActiveTableIndex
var meta
$(function(){
  settings = scraperwiki.readSettings()
  sqliteEndpoint = settings.target.url + '/sqlite'

  async.parallel([
    function (cb) {
      scraperwiki.sql.meta(function(newMeta) {
        meta = newMeta
        tables = filter_and_sort_tables(_.keys(meta.table))
        cb()
      }, handle_ajax_error)
    },
    function (cb) {
      loadAllSettings(function() {
        cb()
      })
    }],
    function (err, results) {
      $('body > .dataTables_processing').remove()
      if(tables.length){
          currentActiveTable = allSettings['active']
          if(isDevTable(currentActiveTable)){
            // we don't want to automatically switch to _ tables
            // so we pretend the state was never saved
            currentActiveTable = undefined
          }
          constructDataTables(currentActiveTable)
      } else {
        $('body').html('<div class="problem"><h4>This dataset is empty.</h4><p>Once your dataset contains data,<br/>it will show up in a table here.</p></div>')
      }
    }
   )
});


