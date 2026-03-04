# TrustHistory


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **UUID** |  | [optional] 
**agent_id** | **UUID** |  | [optional] 
**previous_score** | **int** |  | [optional] 
**new_score** | **int** |  | [optional] 
**change_amount** | **int** |  | [optional] 
**previous_tier** | **str** |  | [optional] 
**new_tier** | **str** |  | [optional] 
**reason** | **str** |  | [optional] 
**category** | **str** |  | [optional] 
**recorded_at** | **datetime** |  | [optional] 

## Example

```python
from agentanchor.models.trust_history import TrustHistory

# TODO update the JSON string below
json = "{}"
# create an instance of TrustHistory from a JSON string
trust_history_instance = TrustHistory.from_json(json)
# print the JSON string representation of the object
print(TrustHistory.to_json())

# convert the object into a dict
trust_history_dict = trust_history_instance.to_dict()
# create an instance of TrustHistory from a dict
trust_history_from_dict = TrustHistory.from_dict(trust_history_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


