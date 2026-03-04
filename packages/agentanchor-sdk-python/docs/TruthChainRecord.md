# TruthChainRecord


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **UUID** |  | [optional] 
**sequence** | **int** | Position in chain | [optional] 
**record_type** | **str** |  | [optional] 
**agent_id** | **UUID** |  | [optional] 
**hash** | **str** | SHA-256 hash of record | [optional] 
**previous_hash** | **str** | Hash of previous record | [optional] 
**data** | **object** | Record payload | [optional] 
**timestamp** | **datetime** |  | [optional] 

## Example

```python
from agentanchor.models.truth_chain_record import TruthChainRecord

# TODO update the JSON string below
json = "{}"
# create an instance of TruthChainRecord from a JSON string
truth_chain_record_instance = TruthChainRecord.from_json(json)
# print the JSON string representation of the object
print(TruthChainRecord.to_json())

# convert the object into a dict
truth_chain_record_dict = truth_chain_record_instance.to_dict()
# create an instance of TruthChainRecord from a dict
truth_chain_record_from_dict = TruthChainRecord.from_dict(truth_chain_record_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


