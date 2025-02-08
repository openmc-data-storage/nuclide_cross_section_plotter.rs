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
        let data = load_data_from_str(include_str!("table_data.json")).expect("Failed to load data from embedded JSON");
        Self { data }
    }
}

fn load_data_from_str(json_str: &str) -> Result<Vec<Entry>, Box<dyn std::error::Error>> {
    let json_data: Vec<serde_json::Value> = serde_json::from_str(json_str)?;
    let mut data = Vec::new();
    for item in json_data {
        let id: i32  = item["i"].as_i64().unwrap() as i32;
        let element = item["e"].as_str().unwrap().to_string();
        let nucleons: i32 = item["n"].as_i64().unwrap() as i32;
        let library = item["l"].as_str().unwrap().to_string();
        let reaction = item["r"].as_str().unwrap().to_string();
        let mt: i32 = item["m"].as_i64().unwrap() as i32;
        let temperature = item["t"].as_str().unwrap().to_string();
        data.push(Entry {
            id,
            element,
            nucleons,
            library,
            reaction,
            mt,
            temperature,
        });
    }
    Ok(data)
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