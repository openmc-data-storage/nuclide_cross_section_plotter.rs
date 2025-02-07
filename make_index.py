import requests
import json
import os


# reads in the JSON index files and makes a more compact table of the data

compact_table = []
local_file_paths = []

urls=[
    "https://raw.githubusercontent.com/openmc-data-storage/ENDF-B-VIII.0-NNDC-json/refs/heads/main/json_files/ENDFB-8.0_index.json",
    "https://raw.githubusercontent.com/openmc-data-storage/FENDL-3.2c-json/refs/heads/main/FENDL-3.2c_json/FENDL-3.2c_index.json",
]
i=0
for url in urls:
    local_file_path= url.split('/')[-1]
    if os.path.exists(local_file_path):
        with open(local_file_path, 'r') as file:
            data = json.load(file)
    else:
        print(f'downloading file {local_file_path}')

        response = requests.get(url)
        data = response.json()
        with open(local_file_path, 'w') as file:
            json.dump(data, file)


    for entry in data:
        
        new_entry = {}
        new_entry['id'] =i
        new_entry['element'] = entry['Atomic symbol']
        new_entry['nucleons'] = entry['Mass number']
        new_entry['library'] = entry['Library']
        new_entry['reaction'] = f'({entry["Incident particle"][0]},{entry["Reaction products"]})'
        new_entry['MT'] = entry['MT reaction number']
        new_entry['temperature'] = entry['Temperature(K)']+"K"
        

        compact_table.append(new_entry)
        
        i=i+1

with open('src/types/table_data.json', 'w') as outfile:
    json.dump(compact_table, outfile, indent=4)

# index_filename
# [
#         {
#             "Proton number": 19,
#             "Mass number": 39,
#             "Neutron number": 20,
#             "Element": "potassium",
#             "Atomic symbol": "K",
#             "Temperature(K)": "0",
#             "Incident particle": "neutron",
#             "Reaction products": "elastic",
#             "MT reaction number": 2,
#             "Library": "FENDL-3.2c"},

#     {
#         "id": 0,
#         "element": "Dy",
#         "nucleons": 157,
#         "library": "ENDFB-8.0",
#         "reaction": "damage-energy",
#         "MT": 444,
#         "temperature": "294K"
#     },