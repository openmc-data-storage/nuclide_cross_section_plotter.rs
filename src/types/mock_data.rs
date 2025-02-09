use std::collections::HashMap;
use std::error::Error;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Data {
    pub data: Vec<Entry>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    pub id: i32,
    pub element: String,
    pub nucleons: i32,
    pub library: String,
    pub reaction: String,
    pub mt: i32,
    pub temperature: String,
}

impl Default for Data {
    fn default() -> Self {
        let data = load_data_from_csv(include_str!("table_data.csv")).expect("Failed to load data from CSV file");
        Self { data }
    }
}


fn load_data_from_csv(csv_data: &str) -> Result<Vec<Entry>, Box<dyn Error>> {
    let expected_headers = vec!["id", "element", "nucleons", "library", "incident_particle", "mt", "temperature"];

    let reaction_name = get_reaction_name_map();
    
    let mut lines = csv_data.lines();

    // Check the headers
    if let Some(header_line) = lines.next() {
        let headers: Vec<&str> = header_line.split(',').collect();
        if headers != expected_headers {
            return Err(format!("CSV header does not match expected columns. Found: {:?}, Expected: {:?}", headers, expected_headers).into());
        }
    } else {
        return Err("Failed to read the header line from the CSV data".into());
    }

    let mut data = Vec::new();
    for line in lines {
        let fields: Vec<&str> = line.split(',').collect();
        if fields.len() != expected_headers.len() {
            return Err(format!("CSV row does not match expected number of columns. Found: {}, Expected: {}", fields.len(), expected_headers.len()).into());
        }
        let mt: i32 = fields[5].parse()?;
        let reaction_description = reaction_name.get(&mt).cloned().unwrap_or_else(|| "unknown".to_string());
        let reaction = format!("(n,{})", reaction_description);
        let entry = Entry {
            id: fields[0].parse()?,
            element: fields[1].to_string(),
            nucleons: fields[2].parse()?,
            library: fields[3].to_string(),
            reaction,
            mt,
            temperature: fields[6].to_string(),
        };
        data.push(entry);
    }
    Ok(data)
}


fn get_reaction_name_map() -> HashMap<i32, String> {
    let mut reaction_name = HashMap::new();
    reaction_name.insert(1, "total".to_string());
    reaction_name.insert(2, "elastic".to_string());
    reaction_name.insert(3, "nonelastic".to_string());
    reaction_name.insert(4, "level".to_string());
    reaction_name.insert(5, "misc".to_string());
    reaction_name.insert(11, "2nd".to_string());
    reaction_name.insert(16, "2n".to_string());
    reaction_name.insert(17, "3n".to_string());
    reaction_name.insert(18, "fission".to_string());
    reaction_name.insert(19, "f".to_string());
    reaction_name.insert(20, "nf".to_string());
    reaction_name.insert(21, "2nf".to_string());
    reaction_name.insert(22, "na".to_string());
    reaction_name.insert(23, "n3a".to_string());
    reaction_name.insert(24, "2na".to_string());
    reaction_name.insert(25, "3na".to_string());
    reaction_name.insert(27, "absorption".to_string());
    reaction_name.insert(28, "np".to_string());
    reaction_name.insert(29, "n2a".to_string());
    reaction_name.insert(30, "2n2a".to_string());
    reaction_name.insert(32, "nd".to_string());
    reaction_name.insert(33, "nt".to_string());
    reaction_name.insert(34, "nHe-3".to_string());
    reaction_name.insert(35, "nd2a".to_string());
    reaction_name.insert(36, "nt2a".to_string());
    reaction_name.insert(37, "4n".to_string());
    reaction_name.insert(38, "3nf".to_string());
    reaction_name.insert(41, "2np".to_string());
    reaction_name.insert(42, "3np".to_string());
    reaction_name.insert(44, "n2p".to_string());
    reaction_name.insert(45, "npa".to_string());
    reaction_name.insert(91, "nc".to_string());
    reaction_name.insert(101, "disappear".to_string());
    reaction_name.insert(102, "gamma".to_string());
    reaction_name.insert(103, "p".to_string());
    reaction_name.insert(104, "d".to_string());
    reaction_name.insert(105, "t".to_string());
    reaction_name.insert(106, "3He".to_string());
    reaction_name.insert(107, "a".to_string());
    reaction_name.insert(108, "2a".to_string());
    reaction_name.insert(109, "3a".to_string());
    reaction_name.insert(111, "2p".to_string());
    reaction_name.insert(112, "pa".to_string());
    reaction_name.insert(113, "t2a".to_string());
    reaction_name.insert(114, "d2a".to_string());
    reaction_name.insert(115, "pd".to_string());
    reaction_name.insert(116, "pt".to_string());
    reaction_name.insert(117, "da".to_string());
    reaction_name.insert(152, "5n".to_string());
    reaction_name.insert(153, "6n".to_string());
    reaction_name.insert(154, "2nt".to_string());
    reaction_name.insert(155, "ta".to_string());
    reaction_name.insert(156, "4np".to_string());
    reaction_name.insert(157, "3nd".to_string());
    reaction_name.insert(158, "nda".to_string());
    reaction_name.insert(159, "2npa".to_string());
    reaction_name.insert(160, "7n".to_string());
    reaction_name.insert(161, "8n".to_string());
    reaction_name.insert(162, "5np".to_string());
    reaction_name.insert(163, "6np".to_string());
    reaction_name.insert(164, "7np".to_string());
    reaction_name.insert(165, "4na".to_string());
    reaction_name.insert(166, "5na".to_string());
    reaction_name.insert(167, "6na".to_string());
    reaction_name.insert(168, "7na".to_string());
    reaction_name.insert(169, "4nd".to_string());
    reaction_name.insert(170, "5nd".to_string());
    reaction_name.insert(171, "6nd".to_string());
    reaction_name.insert(172, "3nt".to_string());
    reaction_name.insert(173, "4nt".to_string());
    reaction_name.insert(174, "5nt".to_string());
    reaction_name.insert(175, "6nt".to_string());
    reaction_name.insert(176, "2n3He".to_string());
    reaction_name.insert(177, "3n3He".to_string());
    reaction_name.insert(178, "4n3He".to_string());
    reaction_name.insert(179, "3n2p".to_string());
    reaction_name.insert(180, "3n3a".to_string());
    reaction_name.insert(181, "3npa".to_string());
    reaction_name.insert(182, "dt".to_string());
    reaction_name.insert(183, "npd".to_string());
    reaction_name.insert(184, "npt".to_string());
    reaction_name.insert(185, "ndt".to_string());
    reaction_name.insert(186, "np3He".to_string());
    reaction_name.insert(187, "nd3He".to_string());
    reaction_name.insert(188, "nt3He".to_string());
    reaction_name.insert(189, "nta".to_string());
    reaction_name.insert(190, "2n2p".to_string());
    reaction_name.insert(191, "p3He".to_string());
    reaction_name.insert(192, "d3He".to_string());
    reaction_name.insert(193, "3Hea".to_string());
    reaction_name.insert(194, "4n2p".to_string());
    reaction_name.insert(195, "4n2a".to_string());
    reaction_name.insert(196, "4npa".to_string());
    reaction_name.insert(197, "3p".to_string());
    reaction_name.insert(198, "n3p".to_string());
    reaction_name.insert(199, "3n2pa".to_string());
    reaction_name.insert(200, "5n2p".to_string());
    reaction_name.insert(444, "damage".to_string());
    reaction_name.insert(649, "pc".to_string());
    reaction_name.insert(699, "dc".to_string());
    reaction_name.insert(749, "tc".to_string());
    reaction_name.insert(799, "3Hec".to_string());
    reaction_name.insert(849, "ac".to_string());
    reaction_name.insert(891, "2nc".to_string());

    for i in 50..91 {
        reaction_name.insert(i, format!("n{}", i - 50));
    }
    for i in 600..649 {
        reaction_name.insert(i, format!("p{}", i - 600));
    }
    for i in 650..699 {
        reaction_name.insert(i, format!("d{}", i - 650));
    }
    for i in 700..749 {
        reaction_name.insert(i, format!("t{}", i - 700));
    }
    for i in 750..799 {
        reaction_name.insert(i, format!("3He{}", i - 750));
    }
    for i in 800..849 {
        reaction_name.insert(i, format!("a{}", i - 800));
    }
    for i in 875..891 {
        reaction_name.insert(i, format!("2n{}", i - 875));
    }

    reaction_name.insert(203, "Xp".to_string());
    reaction_name.insert(204, "Xd".to_string());
    reaction_name.insert(205, "Xt".to_string());
    reaction_name.insert(206, "3He".to_string());
    reaction_name.insert(207, "Xa".to_string());
    reaction_name.insert(301, "heat".to_string());
    reaction_name.insert(901, "displacement NRT".to_string());

    reaction_name
}


pub enum DataActions {
    #[allow(dead_code)]
    RemoveData(i32),
}

impl yew::Reducible for Data {
    type Action = DataActions;

    fn reduce(self: std::rc::Rc<Self>, action: Self::Action) -> std::rc::Rc<Self> {
        let mut new = (*self).clone();
        match action {
            DataActions::RemoveData(id) => {
                new.data.retain(|entry| entry.id != id);
            }
        }
        std::rc::Rc::new(new)
    }
}