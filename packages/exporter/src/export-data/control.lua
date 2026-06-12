script.on_init(function()
    -- EXTRACT SERIALIZED DATA
    local l = tonumber(prototypes.entity["FBE-DATA-COUNT"].localised_name)
    local serialized = ""
    for i = 1, l, 1 do
        serialized = serialized .. prototypes.entity["FBE-DATA-" .. tostring(i)].localised_name
    end
    local data = load(serialized)()
    helpers.write_file('data.json', helpers.table_to_json(data), false, 0)
    -- Dump the actually-loaded mod set (name -> version) so the exporter can
    -- verify it against the requested pack before building the atlas.
    helpers.write_file('active-mods.json', helpers.table_to_json(script.active_mods), false, 0)
    error("!EXIT!")
end)
